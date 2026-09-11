import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), create: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/live-chat", async () => ({
  ...await vi.importActual<typeof import("@/lib/live-chat")>("@/lib/live-chat"),
  listInstructorChatMessages: mocks.list, createInstructorChatMessage: mocks.create,
}));
import { GET, POST } from "./route";
import { LiveChatError } from "@/lib/live-chat";
const body = { liveId: "live-a", submissionId: "viewer-a", body: "只給 A", clientMessageId: "123e4567-e89b-12d3-a456-426614174000" };
function request(query = "liveId=live-a", payload?: unknown) {
  return new Request(`https://app.example.test/api/live-chat/instructor?${query}`, {
    method: payload ? "POST" : "GET",
    headers: { origin: "https://app.example.test", "x-celebratedeal-client": "web", "content-type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ vendor: { id: "tenant-a" }, user: { id: "manager" }, member: { status: "active", role: "owner" } });
  mocks.limit.mockResolvedValue(null);
  mocks.list.mockResolvedValue({ conversations: [], messages: [], nextCursor: null });
  mocks.create.mockResolvedValue({ created: true, message: { source: "instructor", body: "只給 A" } });
});
describe("instructor private chat authorization", () => {
  it("denies viewers and non-managers for reads and replies", async () => {
    for (const auth of [null, { vendor: { id: "tenant-a" }, member: null },
      { vendor: { id: "tenant-a" }, member: { status: "active", role: "support" } },
      { vendor: { id: "tenant-a" }, member: { status: "inactive", role: "owner" } }]) {
      mocks.auth.mockResolvedValue(auth);
      expect((await GET(request())).status).toBe(403);
      expect((await POST(request("", body))).status).toBe(403);
    }
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("derives the tenant from the manager session and uses private no-store", async () => {
    const response = await GET(request("liveId=live-a&submissionId=viewer-b"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.list).toHaveBeenCalledWith({}, { vendorId: "tenant-a", liveId: "live-a", submissionId: "viewer-b" });
    expect((await POST(request("", body))).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({}, { ...body, vendorId: "tenant-a" });
  });
  it("rejects injected tenants, role/source and duplicate query keys", async () => {
    for (const query of ["liveId=a&vendorId=tenant-b", "liveId=a&liveId=b", "liveId=a&source=viewer"]) {
      expect((await GET(request(query))).status).toBe(400);
    }
    for (const payload of [{ ...body, vendorId: "tenant-b" }, { ...body, source: "viewer" }]) {
      expect((await POST(request("", payload))).status).toBe(400);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and missing client headers", async () => {
    const response = await POST(new Request("https://app.example.test/api/live-chat/instructor", {
      method: "POST", headers: { origin: "https://attacker.test" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(403); expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("does not disclose target existence on scoped domain rejection", async () => {
    mocks.list.mockRejectedValue(new LiveChatError("access_denied"));
    mocks.create.mockRejectedValue(new LiveChatError("access_denied"));
    expect((await GET(request())).status).toBe(403);
    expect((await POST(request("", body))).status).toBe(403);
    mocks.create.mockRejectedValue(new LiveChatError("idempotency_conflict"));
    expect((await POST(request("", body))).status).toBe(409);
  });
});
