import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  redeem: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/live-session-switch", () => ({ redeemLiveSessionSwitchToken: mocks.redeem }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import * as route from "./route";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE, verifyFormSubmissionChatSessionToken } from "@/lib/form-submission-chat-session";

const APP = "https://app.example.test";

function post(token: string | null, headers: Record<string, string> = { origin: APP }) {
  const body = new URLSearchParams();
  if (token !== null) body.set("token", token);
  return route.POST(new Request(`${APP}/api/live-session-switch`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  }));
}

function chatCookie(response: Response) {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=`));
}

describe("POST /api/live-session-switch", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
    vi.stubEnv("CSRF_SECRET", "live-session-switch-route-secret-longer-than-32-bytes");
    mocks.checkRateLimit.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("exports only POST, so a link scanner's GET can never redeem", () => {
    expect(Object.keys(route).filter((name) => /^(GET|HEAD|PUT|PATCH|DELETE)$/u.test(name))).toEqual([]);
  });

  it("requires an exact same-origin Origin (not missing, not \"null\") and the rate limit before reading the token", async () => {
    expect((await post("lsw1.a.b", {})).status).toBe(403);
    // A no-referrer page elsewhere posts with Origin: null; that must not plant a registration cookie.
    expect((await post("lsw1.a.b", { origin: "null" })).status).toBe(403);
    expect((await post("lsw1.a.b", { origin: "null", referer: `${APP}/live-session-switch` })).status).toBe(403);
    expect((await post("lsw1.a.b", { origin: "https://evil.example.test" })).status).toBe(403);
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await post("lsw1.a.b")).status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "live-session-switch", 20, 60_000);
    expect(mocks.redeem).not.toHaveBeenCalled();
  });

  it("gives the registration's signed cookie and goes to the registration page on success", async () => {
    mocks.redeem.mockResolvedValue({
      ok: true,
      submissionId: "submission_a",
      rechoosePath: "/lp/spring-webinar",
      registrationCookie: createFormSubmissionChatSessionToken({ submissionId: "submission_a" }),
    });
    const response = await post("lsw1.payload.signature");
    expect(mocks.redeem).toHaveBeenCalledWith("lsw1.payload.signature", expect.any(Date));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/lp/spring-webinar`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const cookie = chatCookie(response)!;
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/Secure/iu);
    expect(cookie).toMatch(/SameSite=lax/iu);
    expect(cookie).toMatch(/Path=\//u);
    const value = decodeURIComponent(cookie.split(";")[0]!.split("=")[1]!);
    expect(verifyFormSubmissionChatSessionToken(value)?.submissionId).toBe("submission_a");
  });

  it("answers every refused link the same way and sets no cookie", async () => {
    mocks.redeem.mockResolvedValue({ ok: false });
    const refused = await post("lsw1.payload.signature");
    expect(refused.status).toBe(303);
    expect(refused.headers.get("location")).toBe(`${APP}/live-session-switch?status=invalid`);
    expect(chatCookie(refused)).toBeUndefined();

    const missing = await post(null);
    expect(missing.headers.get("location")).toBe(`${APP}/live-session-switch?status=invalid`);
    const tooLong = await post("x".repeat(801));
    expect(tooLong.headers.get("location")).toBe(`${APP}/live-session-switch?status=invalid`);
    expect(mocks.redeem).toHaveBeenCalledTimes(1);
  });

  it("asks for another press on a transient conflict and fails closed on anything else", async () => {
    mocks.redeem.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("deadlock", { code: "P2034", clientVersion: "test" }));
    const retry = await post("lsw1.payload.signature");
    expect(retry.headers.get("location")).toBe(`${APP}/live-session-switch?status=retry`);
    expect(chatCookie(retry)).toBeUndefined();

    mocks.redeem.mockRejectedValueOnce(new Error("boom"));
    const failed = await post("lsw1.payload.signature");
    expect(failed.headers.get("location")).toBe(`${APP}/live-session-switch?status=invalid`);
    expect(chatCookie(failed)).toBeUndefined();
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(2);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "live_session_switch", operation: "redeem", status: "failed" });
  });
});
