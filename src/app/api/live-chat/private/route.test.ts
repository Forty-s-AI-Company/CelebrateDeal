import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), list: vi.fn(), create: vi.fn(), csrf: vi.fn(), token: vi.fn(), ip: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/live-private-chat", () => ({ listPrivateViewerChat: mocks.list, createPrivateViewerChat: mocks.create }));
vi.mock("@/lib/csrf", () => ({ verifyCsrfToken: mocks.csrf, getCsrfToken: mocks.token }));
vi.mock("@/lib/request-client-ip", () => ({ getRequestClientIp: mocks.ip }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
import { GET, POST } from "./route";
import { LiveChatError } from "@/lib/live-chat";
const message = { id: "a".repeat(64), source: "viewer", body: "合成問題", createdAt: "2026-10-07T00:00:00.000Z" };
function request(method = "GET", body?: object, query = "vendorId=tenant-a&liveId=live-a") {
  return new Request(`https://app.example.test/api/live-chat/private?${query}`, { method,
    headers: { origin: "https://app.example.test", "x-celebratedeal-client": "web", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
const body = { vendorId: "tenant-a", liveId: "live-a", clientMessageId: "123e4567-e89b-12d3-a456-426614174000", body: "合成問題", csrfToken: "synthetic-token" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.getDb.mockReturnValue({}); mocks.ip.mockReturnValue("203.0.113.5"); mocks.rate.mockResolvedValue(null);
  mocks.csrf.mockResolvedValue(true); mocks.token.mockResolvedValue("synthetic-token");
  mocks.list.mockResolvedValue({ messages: [], nextCursor: null }); mocks.create.mockResolvedValue({ message, created: true });
});
it("mints a CSRF token only after private conversation authorization", async () => {
  mocks.list.mockRejectedValueOnce(new LiveChatError("access_denied"));
  const denied = await GET(request()); expect(denied.status).toBe(403); expect(mocks.token).not.toHaveBeenCalled();
  const allowed = await GET(request()); expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ messages: [], nextCursor: null, csrfToken: "synthetic-token" });
  expect(allowed.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects missing or forged CSRF before any private write", async () => {
  mocks.csrf.mockResolvedValue(false);
  expect((await POST(request("POST", body))).status).toBe(403); expect(mocks.create).not.toHaveBeenCalled();
  expect((await POST(request("POST", { ...body, csrfToken: "" }))).status).toBe(400);
});
it("rejects unknown identity overrides, duplicate query keys and empty normalized bodies", async () => {
  expect((await POST(request("POST", { ...body, submissionId: "viewer-b" }))).status).toBe(400);
  expect((await POST(request("POST", { ...body, body: "　 " }))).status).toBe(400);
  expect((await GET(request("GET", undefined, "vendorId=tenant-a&vendorId=tenant-b&liveId=live-a"))).status).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
});
it("requires trusted write IP and same-origin client marker", async () => {
  mocks.ip.mockReturnValue(null);
  expect((await POST(request("POST", body))).status).toBe(403);
  const cross = request(); cross.headers.set("origin", "https://other.example.test");
  expect((await GET(cross)).status).toBe(403); expect(mocks.list).not.toHaveBeenCalled();
});
it("returns the safe message DTO with create/retry status and no-store errors", async () => {
  const created = await POST(request("POST", body)); expect(created.status).toBe(201); expect(await created.json()).toEqual(message);
  mocks.create.mockResolvedValue({ message, created: false }); expect((await POST(request("POST", body))).status).toBe(200);
  mocks.create.mockRejectedValue(new LiveChatError("idempotency_conflict"));
  const conflict = await POST(request("POST", body)); expect(conflict.status).toBe(409); expect(conflict.headers.get("cache-control")).toBe("private, no-store");
});
