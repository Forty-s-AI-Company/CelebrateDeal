import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = { live: { findFirst: vi.fn() }, $queryRaw: vi.fn() };
const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/monitoring", () => monitoring);

import { GET, POST } from "@/app/api/live-evergreen-session/route";
import { evergreenSessionCookieName } from "@/lib/evergreen-viewer-session";
import {
  createFormSubmissionChatSessionToken,
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
} from "@/lib/form-submission-chat-session";

const evergreenLive = {
  id: "live-1",
  vendorId: "vendor-1",
  status: "scheduled",
  streamMode: "vod",
  isEvergreen: true,
  evergreenScheduleMode: "just_in_time",
  evergreenIntervalMinutes: 15,
  evergreenDailyTimes: [],
  evergreenSessionStartAt: null,
  replayEnabled: false,
  replayAvailableUntil: null,
  vendor: { timezone: "Asia/Taipei" },
  video: { vendorId: "vendor-1", durationSec: 1_800, sourceType: "url", status: "ready", cloudflareReadyToStream: false, cloudflareLiveInputUid: null, liveInputStatus: null },
  form: { vendorId: "vendor-1", isActive: true, fields: [
    { key: "name", label: "姓名", type: "text", required: true },
    { key: "email", label: "Email", type: "email", required: true },
  ] },
  messageTemplate: { vendorId: "vendor-1", channel: "email", trigger: "registration_confirmed", isActive: true, subject: "報名成功", body: "{{name}} {{unsubscribe_url}}" },
  interactionScript: { vendorId: "vendor-1", status: "published" },
  products: [{ vendorId: "vendor-1", product: { vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true } }],
};
const cookieName = evergreenSessionCookieName("live-1");

function post(payload: unknown, cookie?: string) {
  return new Request("https://app.example.test/api/live-evergreen-session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function get(query: string, cookie?: string) {
  return new Request(`https://app.example.test/api/live-evergreen-session?${query}`, {
    headers: { origin: "https://app.example.test", "x-celebratedeal-client": "web", ...(cookie ? { cookie } : {}) },
  });
}

function setCookie(response: Response) {
  const header = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${cookieName}=`));
  return header ?? null;
}

function cookieValue(header: string) {
  return decodeURIComponent(header.slice(cookieName.length + 1).split(";")[0] ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T06:03:00.000Z"));
  vi.stubEnv("CSRF_SECRET", "live-evergreen-session-route-test-secret-0123456789");
  db.live.findFirst.mockResolvedValue(evergreenLive);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/live-evergreen-session", () => {
  it("assigns a server-computed session in an httpOnly cookie and keeps it on repeat", async () => {
    const response = await POST(post({ vendorId: "vendor-1", liveId: "live-1" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ assigned: true, roomState: "waiting_countdown", sessionStartAt: "2026-10-29T06:15:00.000Z", timezone: "Asia/Taipei" });
    const header = setCookie(response);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header?.toLowerCase()).toContain("samesite=lax");
    expect(JSON.stringify(body)).not.toContain(cookieValue(header!));

    vi.setSystemTime(new Date("2026-10-29T06:20:00.000Z"));
    const repeat = await POST(post({ vendorId: "vendor-1", liveId: "live-1" }, `${cookieName}=${cookieValue(header!)}`));
    expect(await repeat.json()).toMatchObject({ sessionStartAt: "2026-10-29T06:15:00.000Z", roomState: "playing", offsetSeconds: 300 });
    expect(setCookie(repeat)).toBeNull();
  });

  it("does not accept a client-chosen start time or unknown fields", async () => {
    const response = await POST(post({ vendorId: "vendor-1", liveId: "live-1", sessionStartAt: "2026-10-29T05:00:00.000Z" }));
    expect(response.status).toBe(400);
    expect(setCookie(response)).toBeNull();
    expect(db.live.findFirst).not.toHaveBeenCalled();
  });

  it("binds the lookup to the requested tenant and only to public evergreen lives", async () => {
    await POST(post({ vendorId: "vendor-1", liveId: "live-1" }));
    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "live-1", vendorId: "vendor-1", isEvergreen: true, OR: expect.any(Array) }),
    }));
    db.live.findFirst.mockResolvedValue(null);
    const missing = await POST(post({ vendorId: "vendor-2", liveId: "live-1" }));
    expect(missing.status).toBe(404);
    expect(setCookie(missing)).toBeNull();
  });

  it("refuses a live that is not publish-ready or no longer evergreen-governed", async () => {
    db.live.findFirst.mockResolvedValue({ ...evergreenLive, form: { ...evergreenLive.form, vendorId: "vendor-2" } });
    expect((await POST(post({ vendorId: "vendor-1", liveId: "live-1" }))).status).toBe(404);
    db.live.findFirst.mockResolvedValue({ ...evergreenLive, status: "ended" });
    expect((await POST(post({ vendorId: "vendor-1", liveId: "live-1" }))).status).toBe(404);
  });

  it("rejoins only after the visitor's own session ended", async () => {
    const first = setCookie(await POST(post({ vendorId: "vendor-1", liveId: "live-1" })))!;
    const cookie = `${cookieName}=${cookieValue(first)}`;
    vi.setSystemTime(new Date("2026-10-29T06:20:00.000Z"));
    const early = await POST(post({ vendorId: "vendor-1", liveId: "live-1", intent: "rejoin" }, cookie));
    expect(await early.json()).toMatchObject({ sessionStartAt: "2026-10-29T06:15:00.000Z" });
    expect(setCookie(early)).toBeNull();

    vi.setSystemTime(new Date("2026-10-29T06:50:00.000Z"));
    const late = await POST(post({ vendorId: "vendor-1", liveId: "live-1", intent: "rejoin" }, cookie));
    expect(await late.json()).toMatchObject({ sessionStartAt: "2026-10-29T07:00:00.000Z", roomState: "waiting_countdown" });
    expect(setCookie(late)).not.toBeNull();
  });

  it("requires the same-origin client header", async () => {
    const response = await POST(new Request("https://app.example.test/api/live-evergreen-session", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.test" },
      body: JSON.stringify({ vendorId: "vendor-1", liveId: "live-1" }),
    }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(setCookie(response)).toBeNull();
  });
});

describe("GET /api/live-evergreen-session", () => {
  it("previews the session a new visitor would get without assigning one", async () => {
    const response = await GET(get("liveId=live-1"));
    expect(await response.json()).toMatchObject({ assigned: false, sessionStartAt: "2026-10-29T06:15:00.000Z" });
    expect(setCookie(response)).toBeNull();
    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ vendorId: expect.anything() }) }));
  });

  it("reports an assigned session from its cookie", async () => {
    const first = setCookie(await POST(post({ vendorId: "vendor-1", liveId: "live-1" })))!;
    const response = await GET(get("liveId=live-1&vendorId=vendor-1", `${cookieName}=${cookieValue(first)}`));
    expect(await response.json()).toMatchObject({ assigned: true, sessionStartAt: "2026-10-29T06:15:00.000Z" });
  });

  it("rejects an empty liveId", async () => {
    expect((await GET(get("liveId="))).status).toBe(400);
    expect(db.live.findFirst).not.toHaveBeenCalled();
  });

  it("ignores unknown query parameters (only liveId and vendorId are read)", async () => {
    const response = await GET(get("liveId=live-1&extra=1"));
    expect(response.status).toBe(200);
    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.not.objectContaining({ extra: expect.anything() }) }));
  });
});

describe("evergreen session cookie lifetime", () => {
  function maxAge(header: string) {
    return Number(/max-age=(\d+)/iu.exec(header)?.[1]);
  }

  it("expires one hour after the visitor's session ends when replay is closed", async () => {
    // Claimed at 06:03 for the 06:15 cohort of a 30-minute video: the session ends 06:45.
    const header = setCookie(await POST(post({ vendorId: "vendor-1", liveId: "live-1" })))!;
    expect(maxAge(header)).toBe((42 + 60) * 60);
    expect(header).toMatch(/Path=\//u);
  });

  it("caps an open-ended replay window at seven days", async () => {
    db.live.findFirst.mockResolvedValue({ ...evergreenLive, replayEnabled: true, replayAvailableUntil: null });
    const header = setCookie(await POST(post({ vendorId: "vendor-1", liveId: "live-1" })))!;
    expect(maxAge(header)).toBe(7 * 24 * 60 * 60);
  });
});

describe("verified registrant session record (F-2)", () => {
  const submissionId = "submission-1";
  function registrationCookie(id = submissionId) {
    return `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(createFormSubmissionChatSessionToken({ submissionId: id }))}`;
  }
  /** The bound values of the single recording statement. */
  function recordedValues() {
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    return db.$queryRaw.mock.calls[0]!.slice(1) as unknown[];
  }

  beforeEach(() => {
    db.$queryRaw.mockResolvedValue([{ id: "assignment-1" }]);
  });

  it("never touches the table for a visitor without a registration cookie", async () => {
    const response = await POST(post({ vendorId: "vendor-1", liveId: "live-1" }));
    expect(response.status).toBe(200);
    expect(setCookie(response)).not.toBeNull();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("ignores a forged or expired registration cookie", async () => {
    const forged = registrationCookie().replace(/.{2}$/u, "xx");
    await POST(post({ vendorId: "vendor-1", liveId: "live-1" }, forged));
    const valid = registrationCookie();
    vi.setSystemTime(new Date("2026-12-15T06:03:00.000Z"));
    await POST(post({ vendorId: "vendor-1", liveId: "live-1" }, valid));
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("records the server-assigned session of a first claim for the signed registration", async () => {
    const response = await POST(post({ vendorId: "vendor-1", liveId: "live-1" }, registrationCookie()));
    expect(await response.json()).toMatchObject({ assigned: true, sessionStartAt: "2026-10-29T06:15:00.000Z" });
    const values = recordedValues();
    expect(values).toEqual(expect.arrayContaining(["vendor-1", "live-1", submissionId, "2026-10-29T06:15:00.000Z"]));
    expect(values.some((value) => typeof value === "string" && /^[0-9a-f]{32}$/u.test(value))).toBe(true);
  });

  it("records a claim that keeps an existing session cookie, and a rejoin's new session", async () => {
    const first = setCookie(await POST(post({ vendorId: "vendor-1", liveId: "live-1" })))!;
    expect(db.$queryRaw).not.toHaveBeenCalled();
    const cookies = `${cookieName}=${cookieValue(first)}; ${registrationCookie()}`;

    vi.setSystemTime(new Date("2026-10-29T06:20:00.000Z"));
    const kept = await POST(post({ vendorId: "vendor-1", liveId: "live-1" }, cookies));
    expect(setCookie(kept)).toBeNull();
    expect(recordedValues()).toContain("2026-10-29T06:15:00.000Z");

    db.$queryRaw.mockClear();
    vi.setSystemTime(new Date("2026-10-29T06:50:00.000Z"));
    const rejoined = await POST(post({ vendorId: "vendor-1", liveId: "live-1", intent: "rejoin" }, cookies));
    expect(await rejoined.json()).toMatchObject({ sessionStartAt: "2026-10-29T07:00:00.000Z" });
    expect(recordedValues()).toContain("2026-10-29T07:00:00.000Z");
  });

  it("records the merchant's shared start for a registrant", async () => {
    db.live.findFirst.mockResolvedValue({ ...evergreenLive, evergreenSessionStartAt: new Date("2026-10-29T08:00:00.000Z") });
    const response = await POST(post({ vendorId: "vendor-1", liveId: "live-1" }, registrationCookie()));
    expect(await response.json()).toMatchObject({ sessionStartAt: "2026-10-29T08:00:00.000Z" });
    expect(recordedValues()).toContain("2026-10-29T08:00:00.000Z");
  });

  it("does not write on GET, even with both cookies", async () => {
    const first = setCookie(await POST(post({ vendorId: "vendor-1", liveId: "live-1" })))!;
    const response = await GET(get("liveId=live-1&vendorId=vendor-1", `${cookieName}=${cookieValue(first)}; ${registrationCookie()}`));
    expect(await response.json()).toMatchObject({ assigned: true });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("answers exactly as before when recording fails", async () => {
    db.$queryRaw.mockRejectedValue(new Error("database unavailable"));
    const response = await POST(post({ vendorId: "vendor-1", liveId: "live-1" }, registrationCookie()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assigned: true, sessionStartAt: "2026-10-29T06:15:00.000Z" });
    expect(setCookie(response)).not.toBeNull();
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      source: "evergreen_session_assignment",
      operation: "viewer_session",
    }));
  });
});
