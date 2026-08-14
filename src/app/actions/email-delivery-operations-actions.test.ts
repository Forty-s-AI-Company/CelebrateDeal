import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManagerContext: vi.fn(),
  requestAuditMeta: vi.fn(),
  parseEmailDeliverySearchInput: vi.fn(),
  loadEmailDeliverySearchResult: vi.fn(),
  requeueEmailDelivery: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.requireVendorManagerContext }));
vi.mock("@/lib/audit", () => ({ requestAuditMeta: mocks.requestAuditMeta }));
vi.mock("@/lib/email-delivery-operations", () => ({
  parseEmailDeliverySearchInput: mocks.parseEmailDeliverySearchInput,
  loadEmailDeliverySearchResult: mocks.loadEmailDeliverySearchResult,
  requeueEmailDelivery: mocks.requeueEmailDelivery,
}));

import { manageEmailDeliveriesAction, type EmailDeliveryOperationsActionState } from "./email-delivery-operations-actions";

const result = {
  criteria: { query: "", status: "ALL" as const, trigger: "ALL" as const, page: 1 },
  items: [],
  counts: {},
  totalItems: 0,
  page: 1,
  totalPages: 1,
  pageSize: 25,
};
const previous: EmailDeliveryOperationsActionState = { status: "idle", message: "", result };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManagerContext.mockResolvedValue({
    vendor: { id: "vendor-1" },
    auth: { member: { id: "member-1", role: "owner" } },
  });
  mocks.requestAuditMeta.mockResolvedValue({ ipAddress: "127.0.0.1", userAgent: "synthetic" });
  mocks.parseEmailDeliverySearchInput.mockReturnValue({
    success: true,
    data: { query: "", status: "ALL", trigger: "ALL", page: 1 },
    retryDeliveryId: null,
  });
  mocks.loadEmailDeliverySearchResult.mockResolvedValue(result);
});

describe("manageEmailDeliveriesAction", () => {
  it("fails CSRF before authentication or database work", async () => {
    mocks.assertServerActionSecurity.mockRejectedValue(new Error("expired"));
    await expect(manageEmailDeliveriesAction(previous, new FormData())).resolves.toMatchObject({
      status: "error",
      message: expect.stringContaining("安全驗證"),
      result: null,
    });
    expect(mocks.requireVendorManagerContext).not.toHaveBeenCalled();
    expect(mocks.loadEmailDeliverySearchResult).not.toHaveBeenCalled();
  });

  it("loads search results with the authenticated vendor only", async () => {
    const response = await manageEmailDeliveriesAction(previous, new FormData());
    expect(response).toMatchObject({ status: "success", result });
    expect(mocks.loadEmailDeliverySearchResult).toHaveBeenCalledWith("vendor-1", {
      query: "",
      status: "ALL",
      trigger: "ALL",
      page: 1,
    });
  });

  it("fails invalid filters closed so the client can retain only its trusted server snapshot", async () => {
    mocks.parseEmailDeliverySearchInput.mockReturnValue({ success: false, message: "請輸入完整收件 Email 或完整寄送編號。" });
    await expect(manageEmailDeliveriesAction(previous, new FormData())).resolves.toEqual({
      status: "error",
      message: "請輸入完整收件 Email 或完整寄送編號。",
      result: null,
    });
    expect(mocks.requireVendorManagerContext).not.toHaveBeenCalled();
    expect(mocks.loadEmailDeliverySearchResult).not.toHaveBeenCalled();
  });

  it("requeues durable state with actor metadata and never invokes a provider", async () => {
    mocks.parseEmailDeliverySearchInput.mockReturnValue({
      success: true,
      data: { query: "", status: "ATTENTION", trigger: "ALL", page: 2 },
      retryDeliveryId: "email_0123456789abcdef0123456789abcdef",
    });
    mocks.requeueEmailDelivery.mockResolvedValue({ status: "requeued", previousStatus: "failed" });

    const response = await manageEmailDeliveriesAction(previous, new FormData());
    expect(response).toMatchObject({ status: "success", message: expect.stringContaining("重新排入寄送佇列") });
    expect(mocks.requeueEmailDelivery).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      deliveryId: "email_0123456789abcdef0123456789abcdef",
      actorId: "member-1",
      actorLabel: "owner",
      ipAddress: "127.0.0.1",
      userAgent: "synthetic",
    });
    expect(mocks.loadEmailDeliverySearchResult).toHaveBeenCalledWith("vendor-1", expect.objectContaining({ page: 2 }));
  });

  it("reports stale and permanently ineligible retries truthfully", async () => {
    mocks.parseEmailDeliverySearchInput.mockReturnValue({
      success: true,
      data: { query: "", status: "ALL", trigger: "ALL", page: 1 },
      retryDeliveryId: "email_0123456789abcdef0123456789abcdef",
    });
    mocks.requeueEmailDelivery.mockResolvedValueOnce({ status: "stale" });
    await expect(manageEmailDeliveriesAction(previous, new FormData())).resolves.toMatchObject({
      status: "success",
      message: expect.stringContaining("舊信已安全停止"),
    });

    mocks.requeueEmailDelivery.mockResolvedValueOnce({ status: "ineligible" });
    await expect(manageEmailDeliveriesAction(previous, new FormData())).resolves.toMatchObject({
      status: "error",
      message: expect.stringContaining("不能手動重試"),
    });
  });
});
