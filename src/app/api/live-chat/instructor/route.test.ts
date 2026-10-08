import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), list: vi.fn(), threads: vi.fn(), create: vi.fn(), csrf: vi.fn(), token: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/live-private-chat", () => ({ listPrivateInstructorChat: mocks.list, listPrivateInstructorConversations: mocks.threads, createPrivateInstructorChat: mocks.create }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: mocks.token, verifyCsrfToken: mocks.csrf }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
import { GET, POST } from "./route";
const actor = { user: { id: "user-a" }, vendor: { id: "tenant-a" }, member: { id: "member-a", role: "owner", status: "active" }, session: { id: "session-a" } };
function request(method = "GET", body?: object, query = "liveId=live-a") {
  return new Request(`https://app.example.test/api/live-chat/instructor?${query}`, { method,
    headers: { origin: "https://app.example.test", "x-celebratedeal-client": "web", "content-type": "application/json", "x-forwarded-for": "198.51.100.42" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
const body = { conversationBinding: "b".repeat(43), liveId: "live-a", submissionId: "viewer-a", body: "合成講師回覆", clientMessageId: "123e4567-e89b-12d3-a456-426614174000", csrfToken: "synthetic-token" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue(actor); mocks.db.mockReturnValue({}); mocks.rate.mockResolvedValue(null);
  mocks.csrf.mockResolvedValue(true); mocks.token.mockResolvedValue("synthetic-token");
  mocks.threads.mockResolvedValue({ conversations: [], nextCursor: null }); mocks.list.mockResolvedValue({ messages: [], nextCursor: null });
  mocks.create.mockResolvedValue({ created: true, message: { id: "a".repeat(64), source: "instructor", body: body.body, createdAt: "2026-10-07T00:00:00.000Z" } });
});
it("denies missing authenticated/MFA actor before any private access", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(403); expect((await POST(request("POST", body))).status).toBe(403);
  expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled();
});
it("denies non-manager and inactive memberships", async () => {
  mocks.auth.mockResolvedValue({ ...actor, member: { ...actor.member, role: "accountant" } });
  expect((await GET(request())).status).toBe(403);
  mocks.auth.mockResolvedValue({ ...actor, member: { ...actor.member, status: "inactive" } });
  expect((await POST(request("POST", body))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled();
});
it("derives tenant, user, membership and session from auth and returns bounded thread/message pages", async () => {
  expect((await GET(request())).status).toBe(200);
  expect(mocks.threads).toHaveBeenCalledWith({}, { vendorId: "tenant-a", userId: "user-a", memberId: "member-a", sessionId: "session-a", liveId: "live-a" });
  expect((await GET(request("GET", undefined, "liveId=live-a&submissionId=viewer-a"))).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith({}, expect.objectContaining({ submissionId: "viewer-a", vendorId: "tenant-a" }));
  const limitRequest = mocks.rate.mock.calls[0][0] as Request;
  expect(limitRequest.headers.get("x-forwarded-for")).toBeNull(); expect(limitRequest.headers.get("cf-connecting-ip")).toBe("unknown");
});
it("rejects tenant/member overrides and missing CSRF without writing", async () => {
  expect((await POST(request("POST", { ...body, vendorId: "tenant-b" }))).status).toBe(400);
  expect((await POST(request("POST", { ...body, memberId: "member-b" }))).status).toBe(400);
  mocks.csrf.mockResolvedValue(false); expect((await POST(request("POST", body))).status).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});
it("keeps responses private and distinguishes a new reply from a retry", async () => {
  const result = await POST(request("POST", body)); expect(result.status).toBe(201); expect(result.headers.get("cache-control")).toBe("private, no-store");
  mocks.create.mockResolvedValue({ created: false, message: {} }); expect((await POST(request("POST", body))).status).toBe(200);
});

it.each([false, true])("rejects an open oversized upload promptly (content-length: %s)", async (declaredLength) => {
  let cancelled = false;
  // 超量後保持開啟，確認拒絕不必等待上傳完成。
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(20_000)); },
    cancel() { cancelled = true; },
  });
  const headers = new Headers({ origin: "https://app.example.test",
    "x-celebratedeal-client": "web", "content-type": "application/json" });
  if (declaredLength) headers.set("content-length", "20000");
  const incoming = new Request("https://app.example.test/api/live-chat/instructor", {
    method: "POST", headers, body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      POST(incoming),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("oversized stream was not rejected promptly")), 1000);
      }),
    ]);
    expect(result.status).toBe(400);
    expect(cancelled).toBe(true);
    const limiterRequest = mocks.rate.mock.calls[0][0] as Request;
    expect(limiterRequest.body).toBeNull();
    expect(limiterRequest.method).toBe("POST");
    expect(limiterRequest.url).toBe(incoming.url);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.csrf).not.toHaveBeenCalled();
  } finally { clearTimeout(timer); }
});
