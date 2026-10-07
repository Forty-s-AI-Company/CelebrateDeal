import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "./db";
const db = getDb();
async function fixture() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic payee shop", slug: `payee-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  const affiliate = await db.affiliate.create({ data: { vendorId: vendor.id, name: "Synthetic payee", code: `PAYEE-${suffix}` } });
  const payout = await db.affiliatePayout.create({ data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-10", finalAmountCents: 3_000_000 } });
  const profile = { vendorId: vendor.id, affiliateId: affiliate.id, bankEncrypted: "synthetic-envelope", taxIdentityEncrypted: "synthetic-envelope", recipientType: "resident_individual", nhiTreatment: "subject_execution_business" };
  const snapshot = { ...profile, payoutId: payout.id, revision: 0, profileRevision: 0, ruleVersion: "synthetic-v1", grossAmountCents: 3_000_000, withholdingTaxCents: 300_000, nhiSupplementaryTaxCents: 63_300, bankFeeCents: 1_500, netPayoutAmountCents: 2_635_200 };
  return { vendor, affiliate, payout, profile, snapshot };
}
describe("affiliate remuneration private database contracts", () => {
  it("rejects foreign tenant and affiliate references", async () => {
    const a = await fixture(), b = await fixture();
    await expect(db.affiliatePayeeProfile.create({ data: { ...a.profile, affiliateId: b.affiliate.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.affiliateRemunerationSnapshot.create({ data: { ...a.snapshot, payoutId: b.payout.id } })).rejects.toMatchObject({ code: "P2003" });
  });
  it("approval is all-or-none and belongs to the current profile revision", async () => {
    const f = await fixture();
    await expect(db.affiliatePayeeProfile.create({ data: { ...f.profile, approvedByUserId: "synthetic-approver", approvedAt: new Date() } })).rejects.toThrow();
    const profile = await db.affiliatePayeeProfile.create({ data: { ...f.profile, approvedRevision: 0, approvedByUserId: "synthetic-approver", approvedAt: new Date() } });
    await expect(db.affiliatePayeeProfile.update({ where: { vendorId_affiliateId: { vendorId: profile.vendorId, affiliateId: profile.affiliateId } }, data: { revision: 1 } })).rejects.toThrow();
    const next = await db.affiliatePayeeProfile.update({ where: { vendorId_affiliateId: { vendorId: f.vendor.id, affiliateId: f.affiliate.id } }, data: { revision: 1, approvedRevision: null, approvedByUserId: null, approvedAt: null } });
    expect(next.approvedRevision).toBeNull();
  });
  it("rejects invalid classification and incomplete exemption", async () => {
    const f = await fixture();
    await expect(db.affiliatePayeeProfile.create({ data: { ...f.profile, nhiTreatment: "documented_exemption" } })).rejects.toThrow();
    await expect(db.affiliatePayeeProfile.create({ data: { ...f.profile, recipientType: "domestic_invoice_business" } })).rejects.toThrow();
  });
  it("rejects monetary imbalance, negative deductions and signature omissions", async () => {
    const f = await fixture();
    await expect(db.affiliateRemunerationSnapshot.create({ data: { ...f.snapshot, netPayoutAmountCents: 1 } })).rejects.toThrow();
    await expect(db.affiliateRemunerationSnapshot.create({ data: { ...f.snapshot, bankFeeCents: -1 } })).rejects.toThrow();
    await expect(db.affiliateRemunerationSnapshot.create({ data: { ...f.snapshot, status: "signed" } })).rejects.toThrow();
    await expect(db.affiliateRemunerationSnapshot.create({ data: { ...f.snapshot, status: "exported", signedAt: new Date(), signedByUserId: "synthetic-signer" } })).rejects.toThrow();
  });
  it("enforces one quote per revision under concurrent creation", async () => {
    const f = await fixture();
    const result = await Promise.allSettled(Array.from({ length: 4 }, () => db.affiliateRemunerationSnapshot.create({ data: f.snapshot })));
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1);
    for (const item of result) if (item.status === "rejected") expect(item.reason).toMatchObject({ code: "P2002" });
  });
  it("keeps private tables protected by RLS without public policies", async () => {
    const rows = await db.$queryRaw<{ relname: string; relrowsecurity: boolean; policies: bigint }[]>`SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies FROM pg_class c WHERE c.relname IN ('AffiliatePayeeProfile', 'AffiliateRemunerationSnapshot')`;
    expect(rows).toHaveLength(2);
    for (const row of rows) { expect(row.relrowsecurity).toBe(true); expect(row.policies).toBe(BigInt(0)); }
  });
});
