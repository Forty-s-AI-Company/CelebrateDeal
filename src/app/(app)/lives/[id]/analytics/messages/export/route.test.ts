import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManagerContext: vi.fn(),
  liveFindFirst: vi.fn(),
  viewerFindMany: vi.fn(),
  scheduledFindMany: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireVendorManagerContext }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    live: { findFirst: mocks.liveFindFirst },
    liveChatMessage: { findMany: mocks.viewerFindMany },
    interactionEvent: { findMany: mocks.scheduledFindMany },
  }),
}));

import { GET } from "./route";

const context = {
  auth: { user: { id: "user-current" }, member: { role: "owner" } },
  vendor: { id: "vendor-current" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManagerContext.mockResolvedValue(context);
  mocks.liveFindFirst.mockResolvedValue({
    id: "live-current",
    scheduledAt: new Date("2026-08-17T10:00:00.000Z"),
    interactionScript: { id: "script-current", vendorId: "vendor-current", status: "published" },
  });
  mocks.viewerFindMany.mockResolvedValue([{
    id: "viewer-1",
    liveId: "live-current",
    authorName: "真實觀眾",
    body: "真人留言",
    createdAt: new Date("2026-08-17T10:00:05.000Z"),
  }]);
  mocks.scheduledFindMany.mockResolvedValue([{
    id: "scheduled-1",
    triggerSec: 10,
    message: "排程留言",
    role: { name: "官方小編" },
  }]);
});

describe("live chat analytics CSV export", () => {
  it("authenticates, scopes both sources to one tenant/live, and exports explicit source semantics", async () => {
    const response = await GET(new Request("https://app.example.test"), { params: Promise.resolve({ id: "live-current" }) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);

    expect(mocks.liveFindFirst).toHaveBeenCalledWith({
      where: { id: "live-current", vendorId: "vendor-current" },
      select: { id: true, scheduledAt: true, interactionScript: { select: { id: true, vendorId: true, status: true } } },
    });
    expect(mocks.viewerFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      vendorId: "vendor-current", liveId: "live-current", source: "viewer", isSimulated: false,
    }) }));
    expect(mocks.scheduledFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      isSimulated: true,
      script: { id: "script-current", vendorId: "vendor-current", status: "published" },
    }) }));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain('"viewer","false","2026-08-17T10:00:05.000Z"');
    expect(csv).toContain('"scheduled","true","2026-08-17T10:00:10.000Z"');
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-current",
      actorId: "user-current",
      action: "download_live_chat_csv",
      targetId: "live-current",
      after: { viewerCount: 1, scheduledCount: 1 },
    }));
  });

  it("returns a private 404 and performs no message query for another vendor's live", async () => {
    mocks.liveFindFirst.mockResolvedValue(null);
    const response = await GET(new Request("https://app.example.test"), { params: Promise.resolve({ id: "foreign-live" }) });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.viewerFindMany).not.toHaveBeenCalled();
    expect(mocks.scheduledFindMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("does not export scheduled rows from a draft or cross-tenant script", async () => {
    mocks.liveFindFirst.mockResolvedValue({
      id: "live-current",
      scheduledAt: new Date("2026-08-17T10:00:00.000Z"),
      interactionScript: { id: "script-foreign", vendorId: "vendor-other", status: "published" },
    });
    const response = await GET(new Request("https://app.example.test"), { params: Promise.resolve({ id: "live-current" }) });
    const csv = await response.text();

    expect(mocks.scheduledFindMany).not.toHaveBeenCalled();
    expect(csv).not.toContain("scheduled-1");
    expect(csv).toContain("viewer-1");
  });
});
