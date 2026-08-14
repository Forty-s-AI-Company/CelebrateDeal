import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  coursePayoutFindMany: vi.fn(),
  recordCoursePayoutOutcomeAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ coursePayout: { findMany: mocks.coursePayoutFindMany } }),
}));
vi.mock("@/app/actions/course-payout-actions", () => ({
  recordCoursePayoutOutcomeAction: mocks.recordCoursePayoutOutcomeAction,
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import AdminCoursePayoutsPage from "./page";

const vendor = { id: "vendor-1", name: "課程商家" };
const recipient = {
  vendorMember: {
    user: { id: "user-f", name: "F 收款人", email: "f@example.test" },
  },
};
const payout = (id: string, status: string, overrides: Record<string, unknown> = {}) => ({
  id,
  monthKey: "2026-07",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  vendor,
  recipient,
  status,
  commissionAmountCents: 5000,
  adjustmentAmountCents: 0,
  finalAmountCents: 5000,
  grossSalesAmountCents: 10000,
  netReferenceAmountCents: 9700,
  outcomeReference: null,
  outcomeReason: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin" } });
  mocks.coursePayoutFindMany.mockResolvedValue([
    payout("course-pending", "pending"),
    payout("course-paid", "paid", { outcomeReference: "manual-ref-2026-07" }),
    payout("course-void", "void", { outcomeReason: "recipient verification failed" }),
  ]);
});

describe("course payout page source attribution", () => {
  it("renders payable totals, recipient identity, outcomes, and pending actions", async () => {
    const html = renderToStaticMarkup(await AdminCoursePayoutsPage({
      searchParams: Promise.resolve({}),
    }));

    expect(mocks.requireFinanceAdmin).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.coursePayoutFindMany).toHaveBeenCalledWith({
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
      include: {
        vendor: true,
        recipient: { include: { vendorMember: { include: { user: true } } } },
      },
    });
    expect(html).toContain("課程 F/G payable");
    expect(html).toContain("待處理筆數");
    expect(html).toContain("$50");
    expect(html).toContain("$100");
    expect(html).toContain("$97");
    expect(html).toContain("Gross 分潤基礎");
    expect(html).toContain("Net 參考");
    expect(html).toContain("Payable");
    expect(html).toContain("F 收款人");
    expect(html).toContain("f@example.test");
    expect(html).toContain("manual-ref-2026-07");
    expect(html).toContain("recipient verification failed");
    expect(html).toContain("記錄 paid");
    expect(html).toContain("記錄 void");
    expect(html).toContain('name="status" value="paid"');
    expect(html).toContain('name="status" value="void"');
    expect(html.match(/aria-busy="false"/gu) ?? []).toHaveLength(2);
    expect(html.match(/aria-disabled="false"/gu) ?? []).toHaveLength(2);
  });

  it("renders a safe error and explicit empty state without reflecting raw input", async () => {
    mocks.coursePayoutFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await AdminCoursePayoutsPage({
      searchParams: Promise.resolve({ error: "raw-provider-error" }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("課程 payout 操作未完成");
    expect(html).not.toContain("raw-provider-error");
    expect(html).toContain("尚無課程 payable");
    expect(html).not.toContain("記錄 paid");
  });
});
