import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ limit: vi.fn(), list: vi.fn(), create: vi.fn(), privateList: vi.fn(), privateCreate: vi.fn(), referral: vi.fn(), broadcasts: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/live-chat", async original => ({ ...await original<typeof import("@/lib/live-chat")>(), listViewerChatMessages: mocks.list, createViewerChatMessage: mocks.create }));
vi.mock("@/lib/live-purchase-broadcasts", async original => ({ ...await original<typeof import("@/lib/live-purchase-broadcasts")>(), listLivePurchaseBroadcasts: mocks.broadcasts }));
vi.mock("@/lib/live-private-chat", () => ({ listPrivateViewerChat: mocks.privateList, createPrivateViewerChat: mocks.privateCreate }));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: async () => "synthetic-csrf", verifyCsrfToken: async () => true }));
vi.mock("@/lib/platform-referral", async original => ({ ...await original<typeof import("@/lib/platform-referral")>(), recordPlatformReferralClick: mocks.referral }));
import { GET as privateGet, POST as privatePost } from "@/app/api/live-chat/private/route";
import { GET as referral } from "@/app/r/[code]/route";
import { GET as chat, POST as chatPost } from "@/app/api/live-chat/messages/route";
import { GET as broadcasts } from "@/app/api/live-purchase-broadcasts/route";
import { LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";
beforeEach(() => {
  vi.clearAllMocks();mocks.limit.mockResolvedValue(null);mocks.db.mockReturnValue({});mocks.list.mockResolvedValue({ messages: [] });mocks.broadcasts.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ created: true, message: { id: "synthetic" } });
  mocks.privateList.mockResolvedValue({ messages: [], conversationBinding: "b".repeat(43) });
  mocks.privateCreate.mockResolvedValue({ created: true, message: { id: "synthetic" } });
  mocks.referral.mockResolvedValue({ id: "synthetic-click" });
  for (const [key, value] of Object.entries({ NODE_ENV: "production", ENTRY_CLIENT_IP_TRUST_MODE: "vercel-native", ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE: "vercel", ENTRY_CLIENT_IP_TOPOLOGY: "direct-vercel", ENTRY_CLIENT_IP_EXPECTED_PROJECT_ID: "synthetic-project", VERCEL_PROJECT_ID: "synthetic-project", VERCEL: "1", VERCEL_ENV: "preview", RATE_LIMIT_PROVIDER: "upstash_redis", NEXT_PUBLIC_APP_URL: "https://preview.example.test" })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());
function request(path: string, ip: string) {
  return new Request(`https://preview.example.test${path}?vendorId=v1&liveId=l1`, { headers: { origin: "https://preview.example.test", "x-celebratedeal-client": "web", "x-vercel-forwarded-for": ip, "cf-connecting-ip": "198.51.100.99", "x-real-ip": "203.0.113.99", cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${"A".repeat(43)}` } });
}
it("actual native chat GET uses exact business IP and separate /64 limiter key", async () => {
  const response = await chat(request("/api/live-chat/messages", "2001:db8:1:2::123"));
  expect(response.status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith({}, expect.objectContaining({ ipAddress: "2001:db8:1:2::123" }));
  expect((mocks.limit.mock.calls[0][0] as Request).headers.get("cf-connecting-ip")).toBe("2001:db8:1:2::");
});
it("actual native broadcast GET reaches authorized business lookup", async () => {
  expect((await broadcasts(request("/api/live-purchase-broadcasts", "192.0.2.5"))).status).toBe(200);
  expect(mocks.broadcasts).toHaveBeenCalledOnce();
  expect((mocks.limit.mock.calls[0][0] as Request).headers.get("cf-connecting-ip")).toBe("192.0.2.5");
});
it.each([chat, broadcasts])("actual routes reject untrusted native source before shared limiter and database", async route => {
  expect((await route(request("/api/live-chat/messages", "192.0.2.5, 192.0.2.6"))).status).toBe(503);
  expect(mocks.limit).not.toHaveBeenCalled();expect(mocks.db).not.toHaveBeenCalled();
});


it.each(["chat-post", "private-get", "private-post"])("real native resolver reaches %s with exact business IP and /64 limit", async kind => {
  const source = request("/api/live-chat/messages", "2001:db8:1:2::123");
  const body = { vendorId: "v1", liveId: "l1", clientMessageId: "123e4567-e89b-12d3-a456-426614174000", body: "Synthetic message", ...(kind === "private-post" ? { csrfToken: "synthetic-csrf", conversationBinding: "b".repeat(43) } : {}) };
  source.headers.set("content-type", "application/json");
  const req = kind === "private-get" ? source : new Request(source.url, { method: "POST", headers: source.headers, body: JSON.stringify(body) });
  const route = kind === "chat-post" ? chatPost : kind === "private-get" ? privateGet : privatePost;
  expect((await route(req)).status).toBe(kind === "private-get" ? 200 : 201);
  const business = kind === "chat-post" ? mocks.create : kind === "private-get" ? mocks.privateList : mocks.privateCreate;
  expect(business).toHaveBeenCalledWith({}, expect.objectContaining({ ipAddress: "2001:db8:1:2::123" }));
  expect((mocks.limit.mock.calls[0][0] as Request).headers.get("cf-connecting-ip")).toBe("2001:db8:1:2::");
});
it("real native referral uses the namespaced key and /64 bucket", async () => {
  const response = await referral(request("/r/synthetic", "2001:db8:1:2::123"), { params: Promise.resolve({ code: "synthetic" }) });
  expect(response.status).toBe(307);expect(mocks.referral).toHaveBeenCalledOnce();
  expect(mocks.limit.mock.calls[0][1]).toBe("entry-vercel-native:platform-referral-entry");
  expect((mocks.limit.mock.calls[0][0] as Request).headers.get("cf-connecting-ip")).toBe("2001:db8:1:2::");
});
it.each([chatPost, privateGet, privatePost])("invalid native identity never reaches write/private business or limiter", async route => {
  const source = request("/api/live-chat/messages", "invalid");
  const response = await route(source);
  expect([403, 503]).toContain(response.status);
  expect(mocks.limit).not.toHaveBeenCalled();expect(mocks.db).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();expect(mocks.privateCreate).not.toHaveBeenCalled();expect(mocks.privateList).not.toHaveBeenCalled();
});
