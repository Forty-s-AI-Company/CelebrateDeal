import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  captureOperationalError: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/payment-paid-automation", () => ({ dispatchPaymentPaidAutomationForOrder: mocks.dispatch }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import {
  PAYMENT_PAID_CATCHUP_MAX_AGE_MS,
  PAYMENT_PAID_CATCHUP_MIN_AGE_MS,
  PAYMENT_PAID_CATCHUP_ORDER_LIMIT,
  PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT,
  runPaymentPaidAutomationCatchup,
} from "@/lib/payment-paid-automation-catchup";

const VALID_RULE = {
  id: "rule-1",
  vendorId: "vendor-1",
  version: 1,
  condition: { type: "order_amount_gte", amountCents: 1_000 },
  actions: [{ type: "add_customer_tag", tag: "已付款" }],
};
const RECORDED_AT = new Date("2026-11-17T00:00:00.000Z");
const NOW = new Date("2026-11-17T01:00:00.000Z");

function candidate(index: number, vendorId = "vendor-1") {
  return { vendorId, orderId: `order-${index}`, recordedAt: RECORDED_AT };
}

function database(rules: unknown[] = [VALID_RULE], candidates: unknown[] = [candidate(1)]) {
  return {
    automationRule: { findMany: vi.fn().mockResolvedValue(rules) },
    $queryRaw: vi.fn().mockResolvedValue(candidates),
  };
}

function run(db: ReturnType<typeof database>, options: Record<string, unknown> = {}) {
  return runPaymentPaidAutomationCatchup({ db: db as never, now: NOW, ...options });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue({ status: "dispatched", results: [{ ruleId: "rule-1", status: "completed" }] });
});

describe("runPaymentPaidAutomationCatchup", () => {
  it("keeps the window between 10 minutes and 48 hours, 20 orders a run", () => {
    expect(PAYMENT_PAID_CATCHUP_MIN_AGE_MS).toBe(10 * 60_000);
    expect(PAYMENT_PAID_CATCHUP_MAX_AGE_MS).toBe(48 * 60 * 60_000);
    expect(PAYMENT_PAID_CATCHUP_ORDER_LIMIT).toBe(20);
  });

  it("reads only active vendor-wide payment_paid rules of unsuspended vendors, and dispatches each candidate with the live path and its recorded time", async () => {
    const db = database([VALID_RULE], [candidate(1), candidate(2, "vendor-2")]);
    await expect(run(db)).resolves.toEqual({
      candidates: 2, examined: 2, completed: 2, skipped: 0, failed: 0, duplicate: 0, notApplicable: 0, errors: 0,
    });
    expect(db.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { trigger: "payment_paid", isActive: true, funnelPageId: null, vendor: { is: { suspendedAt: null } } },
      take: PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT + 1,
    }));
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, { vendorId: "vendor-1", orderId: "order-1" }, db, { rulesUnchangedSince: RECORDED_AT });
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, { vendorId: "vendor-2", orderId: "order-2" }, db, { rulesUnchangedSince: RECORDED_AT });
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it("does not scan orders when no rule can run (none active, or none parses)", async () => {
    for (const rules of [[], [{ ...VALID_RULE, actions: [] }], [{ ...VALID_RULE, condition: { type: "unknown" } }]]) {
      const db = database(rules);
      await expect(run(db)).resolves.toMatchObject({ candidates: 0, examined: 0 });
      expect(db.$queryRaw).not.toHaveBeenCalled();
    }
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("passes only parseable rules and their vendors to the scan, and asks for at most the limit", async () => {
    const broken = { ...VALID_RULE, id: "rule-broken", vendorId: "vendor-broken", actions: "not-a-list" };
    const db = database([VALID_RULE, broken], []);
    await run(db, { limit: 5 });
    const values = (db.$queryRaw.mock.calls[0]?.[0] as { values: unknown[] }).values;
    expect(values).toContainEqual(["vendor-1"]);
    expect(values).toContainEqual(["rule-1"]);
    expect(JSON.stringify(values)).not.toContain("broken");
    expect(values).toContain(5);
    // The window and the reclaim threshold, from `now`.
    expect(values).toContainEqual(new Date(NOW.getTime() - PAYMENT_PAID_CATCHUP_MIN_AGE_MS));
    expect(values).toContainEqual(new Date(NOW.getTime() - PAYMENT_PAID_CATCHUP_MAX_AGE_MS));
    expect(values).toContainEqual(new Date(NOW.getTime() - 5 * 60_000));
    expect(values).toContain("payment.paid:inventory-expiry-reconcile:");
  });

  it("never asks for more than the per-run cap, and a zero limit does nothing", async () => {
    const db = database([VALID_RULE], []);
    await run(db, { limit: 500 });
    expect((db.$queryRaw.mock.calls[0]?.[0] as { values: unknown[] }).values).toContain(PAYMENT_PAID_CATCHUP_ORDER_LIMIT);
    const idle = database();
    await expect(run(idle, { limit: 0 })).resolves.toMatchObject({ candidates: 0, examined: 0 });
    expect(idle.automationRule.findMany).not.toHaveBeenCalled();
  });

  it("reports a truncated rule scan and still runs the rules it read", async () => {
    const rules = Array.from({ length: PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT + 1 }, (_, index) => ({ ...VALID_RULE, id: `rule-${index}`, vendorId: `vendor-${index}` }));
    const db = database(rules, []);
    await run(db);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "payment_paid_automation", operation: "catchup_rule_scan_truncated" });
    const values = (db.$queryRaw.mock.calls[0]?.[0] as { values: unknown[] }).values;
    const ruleIds = values.find((value): value is string[] => Array.isArray(value) && value[0] === "rule-0");
    expect(ruleIds).toHaveLength(PAYMENT_PAID_CATCHUP_RULE_SCAN_LIMIT);
  });

  it("counts every rule result, and reports a failed rule with fixed context only", async () => {
    mocks.dispatch
      .mockResolvedValueOnce({ status: "dispatched", results: [{ ruleId: "a", status: "completed" }, { ruleId: "b", status: "skipped" }, { ruleId: "c", status: "duplicate" }] })
      .mockResolvedValueOnce({ status: "dispatched", results: [{ ruleId: "a", status: "failed" }, { ruleId: "d", status: "invalid_rule" }] })
      .mockResolvedValueOnce({ status: "not_applicable" })
      .mockResolvedValueOnce({ status: "no_rules" });
    const db = database([VALID_RULE], [candidate(1), candidate(2), candidate(3), candidate(4)]);
    await expect(run(db)).resolves.toEqual({
      candidates: 4, examined: 4, completed: 1, skipped: 1, failed: 1, duplicate: 1, notApplicable: 2, errors: 0,
    });
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "payment_paid_automation", operation: "catchup_rule_failed" });
  });

  it("a dispatch that throws is reported without order data and the pass goes on", async () => {
    mocks.dispatch.mockRejectedValueOnce(new Error("synthetic order-1 outage"));
    const db = database([VALID_RULE], [candidate(1), candidate(2)]);
    await expect(run(db)).resolves.toMatchObject({ examined: 2, completed: 1, errors: 1 });
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "payment_paid_automation", operation: "catchup_dispatch" });
  });

  it("monitoring that throws never stops the pass", async () => {
    mocks.captureOperationalError.mockImplementation(() => { throw new Error("monitoring down"); });
    mocks.dispatch.mockRejectedValueOnce(new Error("synthetic outage"));
    const db = database([VALID_RULE], [candidate(1), candidate(2)]);
    await expect(run(db)).resolves.toMatchObject({ examined: 2, errors: 1, completed: 1 });
  });

  it("starts no order after the deadline; the rest wait for the next run", async () => {
    let elapsed = 0;
    mocks.dispatch.mockImplementation(async () => {
      elapsed += 40_000;
      return { status: "dispatched", results: [{ ruleId: "rule-1", status: "completed" }] };
    });
    const db = database([VALID_RULE], [candidate(1), candidate(2), candidate(3)]);
    await expect(run(db, { clock: () => elapsed, deadlineMs: 60_000 })).resolves.toMatchObject({ candidates: 3, examined: 2, completed: 2 });
  });

  it("a failing scan rejects (the job reports it)", async () => {
    const db = database();
    db.$queryRaw.mockRejectedValueOnce(new Error("synthetic database outage"));
    await expect(run(db)).rejects.toThrow("synthetic database outage");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("uses the shared client and the real clock by default", async () => {
    const db = database([], []);
    mocks.getDb.mockReturnValue(db);
    await expect(runPaymentPaidAutomationCatchup()).resolves.toMatchObject({ candidates: 0 });
    expect(db.automationRule.findMany).toHaveBeenCalledOnce();
  });
});
