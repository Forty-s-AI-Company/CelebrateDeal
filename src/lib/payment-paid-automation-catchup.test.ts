import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  captureOperationalError: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/payment-paid-automation", () => ({ dispatchPaymentPaidAutomationForOrder: mocks.dispatch }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));

import { Prisma } from "@prisma/client";
import {
  catchupDispatchFingerprint,
  PAYMENT_PAID_CATCHUP_MAX_AGE_MS,
  PAYMENT_PAID_CATCHUP_MIN_AGE_MS,
  PAYMENT_PAID_CATCHUP_ORDER_LIMIT,
  paymentPaidCatchupDeadline,
  runPaymentPaidAutomationCatchup,
} from "@/lib/payment-paid-automation-catchup";

const RULE = {
  id: "rule-1",
  vendorId: "vendor-1",
  version: 1,
  condition: { type: "order_amount_gte", amountCents: 1_000 },
  actions: [{ type: "add_customer_tag", tag: "已付款" }],
};
const RECORDED_AT = new Date("2026-11-17T00:00:00.000Z");
const NOW = new Date("2026-11-17T01:00:00.000Z");

function candidate(index: number, vendorId = "vendor-1", ruleIds = ["rule-1"]) {
  return { vendorId, orderId: `order-${index}`, recordedAt: RECORDED_AT, ruleIds };
}

/** A fake client: `scans` are returned by successive scans, `rules` by the rule read. */
function database(scans: unknown[][] = [[candidate(1)]], rules: unknown[] = [RULE, { ...RULE, id: "rule-2", vendorId: "vendor-2" }]) {
  const queryRaw = vi.fn();
  for (const rows of scans) queryRaw.mockResolvedValueOnce(rows);
  queryRaw.mockResolvedValue([]);
  return {
    automationRule: { findMany: vi.fn().mockResolvedValue(rules) },
    $queryRaw: queryRaw,
  };
}

function run(db: ReturnType<typeof database>, options: Record<string, unknown> = {}) {
  return runPaymentPaidAutomationCatchup({ db: db as never, now: NOW, ...options });
}

function scanValues(db: ReturnType<typeof database>, call = 0) {
  return (db.$queryRaw.mock.calls[call]?.[0] as Prisma.Sql).values;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.captureOperationalError.mockReset();
  mocks.dispatch.mockResolvedValue({ status: "dispatched", results: [{ ruleId: "rule-1", status: "completed" }] });
});

describe("runPaymentPaidAutomationCatchup", () => {
  it("keeps the window between 10 minutes and 48 hours, 20 orders a run", () => {
    expect(PAYMENT_PAID_CATCHUP_MIN_AGE_MS).toBe(10 * 60_000);
    expect(PAYMENT_PAID_CATCHUP_MAX_AGE_MS).toBe(48 * 60 * 60_000);
    expect(PAYMENT_PAID_CATCHUP_ORDER_LIMIT).toBe(20);
  });

  it("dispatches each candidate with the live path, only the rules the scan chose, and its recorded time", async () => {
    const db = database([[candidate(1), candidate(2, "vendor-2", ["rule-2"])]]);
    await expect(run(db)).resolves.toEqual({
      candidates: 2, examined: 2, completed: 2, skipped: 0, failed: 0, duplicate: 0, notApplicable: 0, errors: 0,
    });
    // The rules are read bound to the scanned vendors and the trigger.
    expect(db.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["rule-1", "rule-2"] }, vendorId: { in: ["vendor-1", "vendor-2"] }, trigger: "payment_paid" },
    }));
    const failedReclaim = { errorCodes: ["action_failed"] };
    expect(mocks.dispatch).toHaveBeenNthCalledWith(1, { vendorId: "vendor-1", orderId: "order-1" }, db, { rulesUnchangedSince: RECORDED_AT, stepsUnchangedSince: RECORDED_AT, onlyRuleIds: ["rule-1"], failedReclaim });
    expect(mocks.dispatch).toHaveBeenNthCalledWith(2, { vendorId: "vendor-2", orderId: "order-2" }, db, { rulesUnchangedSince: RECORDED_AT, stepsUnchangedSince: RECORDED_AT, onlyRuleIds: ["rule-2"], failedReclaim });
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it("passes the window, reclaim, retry and inventory bounds to the scan, as UTC timestamps", async () => {
    const db = database([[]]);
    await run(db, { limit: 5 });
    const sql = (db.$queryRaw.mock.calls[0]?.[0] as Prisma.Sql).sql;
    expect(sql).toContain("AT TIME ZONE 'UTC'");
    expect(sql).toContain(`"startedAt" = l."createdAt"`);
    const values = scanValues(db);
    for (const ms of [PAYMENT_PAID_CATCHUP_MIN_AGE_MS, PAYMENT_PAID_CATCHUP_MAX_AGE_MS, 5 * 60_000]) {
      expect(values).toContain(new Date(NOW.getTime() - ms).toISOString());
    }
    expect(values).toContainEqual(["action_failed"]);
    expect(values).toContainEqual([]);
    expect(values).toContain("payment.paid:inventory-expiry-reconcile:");
    expect(values).toContain(5);
    expect(db.automationRule.findMany).not.toHaveBeenCalled();
  });

  it("never asks for more than the per-run cap, and a zero limit or no time does nothing", async () => {
    const db = database([[]]);
    await run(db, { limit: 500 });
    expect(scanValues(db)).toContain(PAYMENT_PAID_CATCHUP_ORDER_LIMIT);
    for (const options of [{ limit: 0 }, { deadlineMs: 0 }]) {
      const idle = database();
      await expect(run(idle, options)).resolves.toMatchObject({ candidates: 0, examined: 0 });
      expect(idle.$queryRaw).not.toHaveBeenCalled();
    }
  });

  it("leaves unparseable rules out and scans again, so they never take slots", async () => {
    const broken = { ...RULE, id: "rule-broken", actions: "not-a-list" };
    const db = database(
      [[candidate(1, "vendor-1", ["rule-broken"]), candidate(2, "vendor-1", ["rule-1", "rule-broken"])], [candidate(2), candidate(3)]],
      [RULE, broken],
    );
    await expect(run(db)).resolves.toMatchObject({ candidates: 2, examined: 2 });
    expect(scanValues(db, 1)).toContainEqual(["rule-broken"]);
    expect(mocks.dispatch.mock.calls.map((call) => call[0].orderId)).toEqual(["order-2", "order-3"]);
    expect(mocks.dispatch.mock.calls.every((call) => !call[2].onlyRuleIds.includes("rule-broken"))).toBe(true);
  });

  it("stops scanning again after three passes and drops what still cannot run", async () => {
    const broken = (id: string) => ({ ...RULE, id, condition: { type: "unknown" } });
    const db = database(
      [[candidate(1, "vendor-1", ["b1"])], [candidate(2, "vendor-1", ["b2"])], [candidate(3, "vendor-1", ["b3"]), candidate(4)]],
      [RULE, broken("b1"), broken("b2"), broken("b3")],
    );
    await expect(run(db)).resolves.toMatchObject({ candidates: 1, examined: 1 });
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
    expect(mocks.dispatch).toHaveBeenCalledWith({ vendorId: "vendor-1", orderId: "order-4" }, db, expect.anything());
  });

  it("never runs a rule of another vendor than the order's", async () => {
    const db = database([[candidate(1, "vendor-1", ["rule-2"])]], [{ ...RULE, id: "rule-2", vendorId: "vendor-2" }]);
    await expect(run(db)).resolves.toMatchObject({ candidates: 0 });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("counts every rule result, and reports a failed rule with fixed context only", async () => {
    mocks.dispatch
      .mockResolvedValueOnce({ status: "dispatched", results: [{ ruleId: "a", status: "completed" }, { ruleId: "b", status: "skipped" }, { ruleId: "c", status: "duplicate" }] })
      .mockResolvedValueOnce({ status: "dispatched", results: [{ ruleId: "a", status: "failed" }, { ruleId: "d", status: "invalid_rule" }] })
      .mockResolvedValueOnce({ status: "not_applicable" })
      .mockResolvedValueOnce({ status: "no_rules" });
    const db = database([[candidate(1), candidate(2), candidate(3), candidate(4)]]);
    await expect(run(db)).resolves.toEqual({
      candidates: 4, examined: 4, completed: 1, skipped: 1, failed: 1, duplicate: 1, notApplicable: 2, errors: 0,
    });
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "payment_paid_automation", operation: "catchup_rule_failed" }, undefined);
  });

  it("a dispatch that throws is reported with a fingerprint per order and error kind (no ids), and the pass goes on", async () => {
    const outage = Object.assign(new Error("synthetic order-1 outage"), { code: "P1001" });
    mocks.dispatch.mockRejectedValueOnce(outage);
    const db = database([[candidate(1), candidate(2)]]);
    await expect(run(db)).resolves.toMatchObject({ examined: 2, completed: 1, errors: 1 });
    const fingerprint = catchupDispatchFingerprint({ vendorId: "vendor-1", orderId: "order-1" }, outage);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(outage, { source: "payment_paid_automation", operation: "catchup_dispatch" }, { fingerprint });
    expect(fingerprint).toEqual(["payment-paid-catchup-dispatch", expect.stringMatching(/^[0-9a-f]{16}$/), "P1001"]);
    expect(JSON.stringify(fingerprint)).not.toMatch(/vendor-1|order-1/);
    // The same order and kind group together; another order or kind does not.
    expect(catchupDispatchFingerprint({ vendorId: "vendor-1", orderId: "order-1" }, Object.assign(new Error("other text"), { code: "P1001" }))).toEqual(fingerprint);
    expect(catchupDispatchFingerprint({ vendorId: "vendor-1", orderId: "order-2" }, outage)).not.toEqual(fingerprint);
    expect(catchupDispatchFingerprint({ vendorId: "vendor-1", orderId: "order-1" }, new TypeError("x"))[2]).toBe("TypeError");
    expect(catchupDispatchFingerprint({ vendorId: "vendor-1", orderId: "order-1" }, "text")[2]).toBe("unknown");
  });

  it("monitoring that throws never stops the pass", async () => {
    mocks.captureOperationalError.mockImplementation(() => { throw new Error("monitoring down"); });
    mocks.dispatch.mockRejectedValueOnce(new Error("synthetic outage"));
    const db = database([[candidate(1), candidate(2)]]);
    await expect(run(db)).resolves.toMatchObject({ examined: 2, errors: 1, completed: 1 });
  });

  it("starts no order after the deadline; the rest wait for the next run", async () => {
    let elapsed = 0;
    mocks.dispatch.mockImplementation(async () => {
      elapsed += 40_000;
      return { status: "dispatched", results: [{ ruleId: "rule-1", status: "completed" }] };
    });
    const db = database([[candidate(1), candidate(2), candidate(3)]]);
    await expect(run(db, { clock: () => elapsed, deadlineMs: 60_000 })).resolves.toMatchObject({ candidates: 3, examined: 2, completed: 2 });
  });

  it("a failing scan rejects (the job reports it)", async () => {
    const db = database();
    db.$queryRaw.mockReset().mockRejectedValueOnce(new Error("synthetic database outage"));
    await expect(run(db)).rejects.toThrow("synthetic database outage");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("uses the shared client and the real clock by default", async () => {
    const db = database([[]]);
    mocks.getDb.mockReturnValue(db);
    await expect(runPaymentPaidAutomationCatchup()).resolves.toMatchObject({ candidates: 0 });
    expect(db.$queryRaw).toHaveBeenCalledOnce();
  });
});

describe("paymentPaidCatchupDeadline (the scheduler waits 120 s for the route)", () => {
  it("is 60 s while the route is quick, what is left of 100 s after 40 s, and null (skip) from 60 s", () => {
    expect(paymentPaidCatchupDeadline(0)).toBe(60_000);
    expect(paymentPaidCatchupDeadline(40_000)).toBe(60_000);
    expect(paymentPaidCatchupDeadline(50_000)).toBe(50_000);
    expect(paymentPaidCatchupDeadline(59_999)).toBe(40_001);
    expect(paymentPaidCatchupDeadline(60_000)).toBeNull();
    expect(paymentPaidCatchupDeadline(Number.NaN)).toBeNull();
    expect(paymentPaidCatchupDeadline(-5)).toBe(60_000);
  });
});
