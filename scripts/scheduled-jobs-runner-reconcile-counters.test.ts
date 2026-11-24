import { describe, expect, it } from "vitest";
import { runPendingPaymentReconciliation, type PaymentReconcileSummary } from "@/lib/payment-pending-reconciliation";

// A4-05: the scheduled-jobs runner prints payment-reconcile counters by name.
// A renamed or misspelled counter would silently never print, so every name must
// be a real PaymentReconcileSummary key. The disabled path returns the whole
// summary without touching the database or PayUni.
describe("scheduled-jobs runner payment-reconcile report counters", () => {
  it("lists only PaymentReconcileSummary keys, and every numeric one except the attention counter", async () => {
    const { PAYMENT_RECONCILE_REPORT_COUNTERS, ATTENTION_COUNTERS, findScheduledJob } = await import("./scheduled-jobs-runner.mjs");
    const summary: PaymentReconcileSummary = await runPendingPaymentReconciliation({ env: {} });
    expect(summary.skipped).toBe("disabled");
    const numericKeys = Object.keys(summary).filter((key) => typeof summary[key as keyof PaymentReconcileSummary] === "number");
    for (const name of PAYMENT_RECONCILE_REPORT_COUNTERS) expect(numericKeys).toContain(name);
    // Nothing is left out: each numeric summary key is either reported or already an attention counter.
    expect([...numericKeys].sort()).toEqual([...new Set([...PAYMENT_RECONCILE_REPORT_COUNTERS, ...ATTENTION_COUNTERS.filter((key: string) => key in summary)])].sort());
    const job = findScheduledJob("payment-reconcile") as { reportSkipped?: readonly string[] } | null;
    expect(job?.reportSkipped).toEqual(["disabled", "provider_unavailable"]);
  });
});
