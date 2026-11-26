import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  liveViewerSession: { findUnique: vi.fn() },
  liveViewerProfile: { findUnique: vi.fn(), upsert: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  live: { findFirst: vi.fn() },
  formSubmission: { findFirst: vi.fn() },
  blacklist: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
};
const rateLimit = vi.hoisted(() => ({ checkRateLimit: vi.fn<(...args: unknown[]) => Promise<Response | null>>(async () => null) }));

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => rateLimit);

import { GET, PUT } from "@/app/api/live-viewer-profile/route";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { interactionRoleAvatarUrl } from "@/lib/interaction-role";
import { hashLiveViewerToken, LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";
import { hashLiveViewerProfileKey, LIVE_VIEWER_PROFILE_COOKIE } from "@/lib/live-viewer-profile";

const ORIGIN = "https://app.example.test";
const ADMISSION = "A".repeat(43);
const PROFILE = "P".repeat(43);

function headers(cookie: string | null, extra: Record<string, string> = {}) {
  return {
    origin: ORIGIN,
    "x-celebratedeal-client": "web",
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
    ...extra,
  };
}

function getRequest(query = "vendorId=vendor-1&liveId=live-1", cookie: string | null = `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}`, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/live-viewer-profile?${query}`, { headers: headers(cookie, extra) });
}

function putRequest(body: unknown, cookie: string | null = `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}`) {
  return new Request(`${ORIGIN}/api/live-viewer-profile`, { method: "PUT", headers: headers(cookie), body: JSON.stringify(body) });
}

function setCookie(response: Response, name: string) {
  return response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`)) ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "live-viewer-profile-route-test-secret-over-32-bytes");
  rateLimit.checkRateLimit.mockResolvedValue(null);
  db.liveViewerSession.findUnique.mockResolvedValue({ vendorId: "vendor-1", liveId: "live-1", expiresAt: new Date(Date.now() + 60_000) });
  db.liveViewerProfile.findUnique.mockResolvedValue(null);
  db.liveViewerProfile.upsert.mockResolvedValue({ id: "profile-1", nickname: "小明", avatarSeed: "host-blue", normalizedNickname: "小明", lastActiveAt: new Date() });
  db.liveViewerProfile.count.mockResolvedValue(0);
  db.liveViewerProfile.updateMany.mockResolvedValue({ count: 0 });
  db.$queryRaw.mockResolvedValue([]);
  db.blacklist.findMany.mockResolvedValue([]);
  db.live.findFirst.mockResolvedValue({ vendor: { name: "幸福烘焙" }, interactionScript: null });
  db.formSubmission.findFirst.mockResolvedValue(null);
});

describe("GET /api/live-viewer-profile", () => {
  it("requires the same-origin client marker before anything else", async () => {
    const response = await GET(new Request(`${ORIGIN}/api/live-viewer-profile?vendorId=vendor-1&liveId=live-1`, { headers: { origin: ORIGIN } }));
    expect(response.status).toBe(403);
    expect(rateLimit.checkRateLimit).not.toHaveBeenCalled();
    expect(db.liveViewerSession.findUnique).not.toHaveBeenCalled();
  });

  it("refuses unknown or repeated query keys", async () => {
    expect((await GET(getRequest("vendorId=vendor-1&liveId=live-1&extra=1"))).status).toBe(400);
    expect((await GET(getRequest("vendorId=vendor-1&liveId=live-1&liveId=live-2"))).status).toBe(400);
  });

  it("returns 403 without an admission for exactly this live", async () => {
    expect((await GET(getRequest(undefined, null))).status).toBe(403);
    db.liveViewerSession.findUnique.mockResolvedValue({ vendorId: "vendor-1", liveId: "live-other", expiresAt: new Date(Date.now() + 60_000) });
    const response = await GET(getRequest());
    expect(response.status).toBe(403);
    expect(db.liveViewerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("returns the viewer's own profile, private and uncached", async () => {
    db.liveViewerProfile.findUnique.mockResolvedValue({ id: "profile-1", nickname: "小明", avatarSeed: "care-teal", normalizedNickname: "小明", lastActiveAt: new Date() });
    const response = await GET(getRequest(undefined, `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}; ${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      profile: { nickname: "小明", avatarSeed: "care-teal", avatarUrl: interactionRoleAvatarUrl("care-teal") },
      suggestedNickname: null,
      canSetNickname: true,
    });
    expect(db.liveViewerProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_liveId_viewerKeyHash: { vendorId: "vendor-1", liveId: "live-1", viewerKeyHash: hashLiveViewerProfileKey(PROFILE, "live-1") } },
    }));
  });

  it("suggests the verified registrant's own name when no profile exists", async () => {
    const chat = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date() });
    db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", name: "王大明", email: "a@example.test", phone: null, formId: "form-1", live: { formId: "form-1" } });
    const response = await GET(getRequest(undefined, `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}; ${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(chat)}`));
    expect(await response.json()).toEqual({ profile: null, suggestedNickname: "王大明", canSetNickname: true });
    expect(db.formSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "submission-1", liveId: "live-1", verificationStatus: "VERIFIED", form: { vendorId: "vendor-1" } }),
    }));
  });

  it("asks again with the old name when the profile's name was released, ahead of the registration name", async () => {
    db.liveViewerProfile.findUnique.mockResolvedValue({ id: "profile-1", nickname: "小雨", avatarSeed: "care-teal", normalizedNickname: null, lastActiveAt: new Date(0) });
    db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", name: "王大明", email: "a@example.test", phone: null, formId: "form-1", live: { formId: "form-1" } });
    const chat = createFormSubmissionChatSessionToken({ submissionId: "submission-1", now: new Date() });
    const response = await GET(getRequest(undefined, `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}; ${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}; ${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${encodeURIComponent(chat)}`));
    expect(await response.json()).toEqual({ profile: null, suggestedNickname: "小雨", canSetNickname: true });
  });

  it("tells a blacklisted viewer the nickname step is unavailable, without saying why", async () => {
    db.blacklist.findMany.mockResolvedValue([{ identifier: hashLiveViewerToken(ADMISSION), identifierType: "visitor_id" }]);
    db.liveViewerProfile.findUnique.mockResolvedValue({ id: "profile-1", nickname: "小明", avatarSeed: "care-teal", normalizedNickname: "小明", lastActiveAt: new Date() });
    const response = await GET(getRequest(undefined, `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}; ${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}`));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ profile: null, suggestedNickname: null, canSetNickname: false, reason: "unavailable" });
    expect(JSON.stringify(payload)).not.toMatch(/visitor|email|phone|ip|blacklist/iu);
    // The blacklist is read for this vendor only.
    expect(db.blacklist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }) }));
  });

  it("passes a rate limit refusal through", async () => {
    rateLimit.checkRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(getRequest())).status).toBe(429);
    expect(rateLimit.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "live-viewer-profile-read-ip", 600, 60_000);
  });
});

describe("PUT /api/live-viewer-profile", () => {
  const body = { vendorId: "vendor-1", liveId: "live-1", nickname: "小明", avatarSeed: "host-blue" };

  it("saves, issues the profile cookie and binds the write to the session's live", async () => {
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: { nickname: "小明", avatarSeed: "host-blue", avatarUrl: interactionRoleAvatarUrl("host-blue") } });
    const cookie = setCookie(response, LIVE_VIEWER_PROFILE_COOKIE);
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=lax/iu);
    expect(cookie).toMatch(/Secure/iu);
    expect(cookie).toMatch(/Path=\/api(?:;|$)/u);
    const upsert = db.liveViewerProfile.upsert.mock.calls[0]?.[0] as { create: Record<string, unknown> };
    expect(upsert.create).toMatchObject({ vendorId: "vendor-1", liveId: "live-1" });
    expect(rateLimit.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "live-viewer-profile-write-ip", 300, 60_000);
    expect(rateLimit.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "live-viewer-profile-write", 10, 60_000);
  });

  it("does not reissue the cookie for a returning viewer", async () => {
    const response = await PUT(putRequest(body, `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}; ${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}`));
    expect(response.status).toBe(200);
    expect(setCookie(response, LIVE_VIEWER_PROFILE_COOKIE)).toBeNull();
  });

  it("answers a taken name with 409 and the owner's wording", async () => {
    const response = await PUT(putRequest({ ...body, nickname: "幸福 烘焙" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "nickname_taken", message: "這個名稱已經有人使用，請換一個" });
    expect(db.liveViewerProfile.upsert).not.toHaveBeenCalled();
  });

  it("refuses invalid input, foreign avatars, extra fields and a cross-live session", async () => {
    expect((await PUT(putRequest({ ...body, nickname: "https://spam.example" }))).status).toBe(400);
    expect((await PUT(putRequest({ ...body, avatarSeed: undefined, avatarUrl: "https://evil.example/a.png" }))).status).toBe(400);
    expect((await PUT(putRequest({ ...body, viewerKeyHash: "x" }))).status).toBe(400);
    db.liveViewerSession.findUnique.mockResolvedValue({ vendorId: "vendor-2", liveId: "live-1", expiresAt: new Date(Date.now() + 60_000) });
    expect((await PUT(putRequest(body))).status).toBe(403);
    expect(db.liveViewerProfile.upsert).not.toHaveBeenCalled();
  });

  it("applies the vendor's keyword rules to the nickname", async () => {
    db.blacklist.findMany.mockResolvedValue([{ identifier: "假貨", identifierType: "keyword" }]);
    const response = await PUT(putRequest({ ...body, nickname: "賣假貨" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "nickname_blocked", message: "這個名稱無法使用，請換一個" });
    expect(db.blacklist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", isActive: true }) }));
    expect(db.liveViewerProfile.upsert).not.toHaveBeenCalled();
  });

  it("refuses a viewer whose admission visitor id is blacklisted", async () => {
    db.blacklist.findMany.mockResolvedValue([{ identifier: hashLiveViewerToken(ADMISSION), identifierType: "visitor_id" }]);
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "blocked" });
    expect(db.liveViewerProfile.upsert).not.toHaveBeenCalled();
  });

  it("answers 429 once one admission session created three profiles", async () => {
    db.liveViewerProfile.count.mockResolvedValue(3);
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "too_many_profiles" });
    expect(setCookie(response, LIVE_VIEWER_PROFILE_COOKIE)).toBeNull();
    expect(db.liveViewerProfile.upsert).not.toHaveBeenCalled();
  });

  it("limits new profiles per IP and live each hour, but not renames", async () => {
    rateLimit.checkRateLimit.mockImplementation(async (_request: unknown, key: unknown) => (
      key === "live-viewer-profile-create:live-1" ? new Response(null, { status: 429 }) : null
    ));
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "too_many_profiles" });
    expect(rateLimit.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), "live-viewer-profile-create:live-1", 300, 3_600_000);
    expect(db.liveViewerProfile.upsert).not.toHaveBeenCalled();

    db.liveViewerProfile.findUnique.mockResolvedValue({ id: "profile-1" });
    const renamed = await PUT(putRequest(body, `${LIVE_VIEWER_SESSION_COOKIE}=${ADMISSION}; ${LIVE_VIEWER_PROFILE_COOKIE}=${PROFILE}`));
    expect(renamed.status).toBe(200);
  });

  it("returns a generic 500 when storage fails", async () => {
    db.liveViewerProfile.upsert.mockRejectedValue(new Error("db down"));
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to save the nickname" });
  });
});
