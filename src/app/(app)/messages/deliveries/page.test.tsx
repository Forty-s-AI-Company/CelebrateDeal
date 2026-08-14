import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  loadEmailDeliverySearchResult: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/email-delivery-operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email-delivery-operations")>()),
  loadEmailDeliverySearchResult: mocks.loadEmailDeliverySearchResult,
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));

import MessageDeliveriesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.loadEmailDeliverySearchResult.mockResolvedValue({
    criteria: { query: "", status: "ALL", trigger: "ALL", page: 1 },
    items: [{
      id: "email_0123456789abcdef0123456789abcdef",
      recipientMaskedEmail: "l***@example.test",
      status: "failed",
      trigger: "registration_confirmed",
      attemptCount: 2,
      maxAttempts: 5,
      manualRetryCount: 0,
      createdAtLabel: "2026/8/10 上午9:00",
      sentAtLabel: null,
      nextAttemptAtLabel: "2026/8/10 上午9:15",
      lastManualRetryAtLabel: null,
      lastErrorCode: "network",
      canRetry: true,
    }],
    counts: { failed: 1, activeSuppressions: 2 },
    totalItems: 1,
    page: 1,
    totalPages: 1,
    pageSize: 25,
  });
});

describe("MessageDeliveriesPage", () => {
  it("renders tenant-scoped merchant search, delivery guidance and safe retry feedback", async () => {
    const html = renderToStaticMarkup(await MessageDeliveriesPage());
    expect(html).toContain("Email 寄送營運");
    expect(html).toContain("完整收件 Email 或寄送編號");
    expect(html).toContain("l***@example.test");
    expect(html).toContain("寄送服務連線暫時失敗");
    expect(html).toContain("重新排程");
    expect(html).toContain("有效退訂");
    expect(html).not.toContain("lead@example.test");
    expect(mocks.loadEmailDeliverySearchResult).toHaveBeenCalledWith("vendor-1", {
      query: "",
      status: "ALL",
      trigger: "ALL",
      page: 1,
    });
  });
});
