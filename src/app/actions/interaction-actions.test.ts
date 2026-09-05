import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertSecurity: vi.fn(),
  authContext: vi.fn(),
  findLive: vi.fn(),
  createRun: vi.fn(),
  findRun: vi.fn(),
  updateRun: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertSecurity }));
vi.mock("@/lib/auth", () => ({
  requireVendorManager: vi.fn(),
  requireVendorManagerContext: mocks.authContext,
}));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.audit }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  live: { findFirst: mocks.findLive },
  liveInteractionRun: { create: mocks.createRun, findFirst: mocks.findRun, updateMany: mocks.updateRun },
}) }));

import { drawLiveInteractionWinnerAction, startLiveInteractionAction } from "./interaction-actions";

function startForm(eventType: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    liveId: "live-1", eventType, title: "直播互動", durationSec: "60",
    slogan: "週年快樂", question: "你選哪個？", options: "A\nB",
    maxClaims: "100", discountType: "percentage", discountValue: "10",
  })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authContext.mockResolvedValue({
    vendor: { id: "vendor-1" },
    auth: { user: { id: "user-1" }, member: { id: "member-1", role: "owner" } },
  });
  mocks.findLive.mockResolvedValue({ id: "live-1", products: [] });
  mocks.createRun.mockImplementation(async ({ data }) => ({ id: "run-1", ...data }));
  mocks.updateRun.mockResolvedValue({ count: 1 });
});

describe("Live Studio advanced interaction actions", () => {
  it("starts a normalized manual poll for a tenant-owned live broadcast", async () => {
    const result = await startLiveInteractionAction({ status: "idle", message: "" }, startForm("poll"));
    expect(result).toMatchObject({ status: "success", runId: "run-1" });
    expect(mocks.findLive).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "live-1", vendorId: "vendor-1", status: "live" } }));
    expect(mocks.createRun).toHaveBeenCalledWith({ data: expect.objectContaining({
      source: "manual", eventType: "poll", createdByMemberId: "member-1",
      configuration: expect.objectContaining({ kind: "poll", question: "你選哪個？" }),
    }) });
  });

  it("fails closed when Studio tries to start an interaction outside a live broadcast", async () => {
    mocks.findLive.mockResolvedValueOnce(null);
    const result = await startLiveInteractionAction({ status: "idle", message: "" }, startForm("lucky_draw"));
    expect(result).toMatchObject({ status: "error" });
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("draws the only eligible response exactly once", async () => {
    mocks.findRun.mockResolvedValueOnce({ id: "run-1", responses: [{ id: "response-1" }] });
    const form = new FormData();
    form.set("runId", "run-1");
    const result = await drawLiveInteractionWinnerAction({ status: "idle", message: "" }, form);
    expect(result).toMatchObject({ status: "success", runId: "run-1" });
    expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run-1", vendorId: "vendor-1", winnerResponseId: null },
      data: expect.objectContaining({ winnerResponseId: "response-1", status: "closed" }),
    }));
  });
});
