import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PAYMENT_RECONCILE_MAX_ATTEMPTS, paymentReconcileDelayMs, PAYMENT_RECONCILE_MAX_AGE_MS } from "@/lib/payment-pending-reconciliation";

describe("payment pending reconciliation schema contract (A-2 05)", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const migration = fs.readFileSync("prisma/migrations/20261119110000_payment_pending_reconciliation/migration.sql", "utf8");
  const model = /model PaymentPendingReconciliation \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";

  it("keeps the Prisma model and the additive migration aligned", () => {
    expect(model).not.toBe("");
    for (const field of ["vendorId", "paymentTransactionId", "providerName", "status", "attempts", "lastQueriedAt", "nextQueryAt", "lastOutcome", "resolvedAt"]) {
      expect(model).toContain(field);
      expect(migration).toContain(`"${field}"`);
    }
    expect(model).toContain("@@unique([vendorId, paymentTransactionId])");
    expect(model).toContain("@@index([status, nextQueryAt])");
    expect(migration).toContain(`CHECK ("status" IN ('active', 'settled', 'closed', 'needs_manual_review'))`);
    expect(migration).toContain(`CHECK ("lastOutcome" IS NULL OR "lastOutcome" ~ '^[a-z_]{1,64}$')`);
    expect(migration).toContain(`CHECK (("status" = 'active') = ("resolvedAt" IS NULL))`);
    // Additive only: no statement changes or removes existing rows or objects.
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/mu);
    expect(migration).toMatch(/set_config\('lock_timeout', '5s', true\)/u);
  });

  it("binds every row to its own vendor's payment and keeps the table out of the Data API", () => {
    expect(model).toContain("@relation(fields: [vendorId, paymentTransactionId], references: [vendorId, id], onDelete: Cascade)");
    expect(migration).toContain('FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE CASCADE');
    expect(migration).toContain('ALTER TABLE "PaymentPendingReconciliation" ENABLE ROW LEVEL SECURITY;');
    expect(migration).not.toMatch(/\bGRANT\b/iu);
  });

  it("fits every allowed query inside the scan window, under the attempts CHECK", () => {
    const attemptsCeiling = Number(/CHECK \("attempts" BETWEEN 0 AND (\d+)\)/u.exec(migration)?.[1]);
    expect(PAYMENT_RECONCILE_MAX_ATTEMPTS).toBeLessThan(attemptsCeiling);
    // The first query happens at the minimum age; each later one after the previous wait.
    let elapsed = 15 * 60_000;
    for (let attempt = 1; attempt < PAYMENT_RECONCILE_MAX_ATTEMPTS; attempt += 1) elapsed += paymentReconcileDelayMs(attempt);
    expect(elapsed).toBeLessThan(PAYMENT_RECONCILE_MAX_AGE_MS);
    expect([1, 2, 3, 4, 7, 20].map(paymentReconcileDelayMs)).toEqual([15, 30, 60, 120, 720, 720].map((minutes) => minutes * 60_000));
  });
});
