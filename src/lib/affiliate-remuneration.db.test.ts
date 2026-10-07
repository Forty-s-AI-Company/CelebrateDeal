import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getDb } from "./db";
import { createBankAccountKeyring } from "./bank-account";
import { AffiliatePayeeConflict, approveAffiliatePayeeProfile, submitAffiliatePayeeProfile } from "./affiliate-payee-profile";
import { createAffiliateRemunerationQuote, signAffiliateRemunerationQuote } from "./affiliate-remuneration-quotes";
import { appendCommissionLedgerEntry } from "./affiliate-commission-accounting";
const db = getDb();
const keyring = createBankAccountKeyring({ activeKeyId: "synthetic", keys: { synthetic: Buffer.alloc(32, 4).toString("base64url") } });
const submission = { expectedRevision: 0, bank: { accountName: "Synthetic", bankCode: "999", accountNumber: "123456789" }, taxIdentity: "SYNTHETIC123", recipientType: "resident_individual", nhiTreatment: "subject_execution_business" };
async function grant(f: Awaited<ReturnType<typeof fixture>>, role = "partner") {
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: "Synthetic member", passwordHash: "synthetic-only", memberships: { create: { vendorId: f.vendor.id, role, status: "active" } } }, include: { memberships: true } });
  if (role === "partner") await db.affiliatePortalAccess.create({ data: { vendorId: f.vendor.id, affiliateId: f.affiliate.id, vendorMemberId: user.memberships[0]!.id } });
  return { userId: user.id };
}
async function fixture() {
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic payee shop", slug: `payee-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  const affiliate = await db.affiliate.create({ data: { vendorId: vendor.id, name: "Synthetic payee", code: `PAYEE-${suffix}` } });
  const payout = await db.affiliatePayout.create({ data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-10", finalAmountCents: 3_000_000 } });
  const profile = { vendorId: vendor.id, affiliateId: affiliate.id, bankEncrypted: "synthetic-envelope", taxIdentityEncrypted: "synthetic-envelope", recipientType: "resident_individual", nhiTreatment: "subject_execution_business" };
  const snapshot = { ...profile, payoutId: payout.id, revision: 0, profileRevision: 0, ruleVersion: "synthetic-v1", grossAmountCents: 3_000_000, withholdingTaxCents: 300_000, nhiSupplementaryTaxCents: 63_300, bankFeeCents: 1_500, netPayoutAmountCents: 2_635_200 };
  return { vendor, affiliate, payout, profile, snapshot };
}
async function payableFixture() {
  const f = await fixture(), actor = await grant(f), manager = await grant(f, "owner");
  const scope = { vendorId: f.vendor.id, affiliateId: f.affiliate.id };
  await submitAffiliatePayeeProfile(db, actor, scope, submission, keyring);
  await approveAffiliatePayeeProfile(db, manager, scope, 1);
  const commission = await db.affiliateCommission.create({ data: { ...scope, monthKey: "2026-10", status: "locked", deduplicationKey: randomUUID(), orderAmountCents: 30_000_000, commissionBaseAmountCents: 30_000_000, commissionRateBps: 1000, commissionAmountCents: 3_000_000 } });
  const event = { vendorId: scope.vendorId, affiliateCommissionId: commission.id, providerName: "synthetic", eventIdentity: randomUUID(), occurredAt: new Date() };
  await db.$transaction(tx => appendCommissionLedgerEntry(tx, { ...event, entryType: "opening_balance", amountCents: 3_000_000 }));
  return { ...f, actor, manager, scope, commission, event };
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
  it("denies foreign or revoked submitters and partner approval", async () => {
    const f = await fixture(), foreign = await fixture();
    const actor = await grant(f), other = await grant(foreign);
    const scope = { vendorId: f.vendor.id, affiliateId: f.affiliate.id };
    expect(await submitAffiliatePayeeProfile(db, other, scope, submission, keyring)).toBeNull();
    await submitAffiliatePayeeProfile(db, actor, scope, submission, keyring);
    expect(await approveAffiliatePayeeProfile(db, actor, scope, 1)).toBeNull();
    await db.affiliatePortalAccess.update({ where: { vendorId_affiliateId: scope }, data: { active: false } });
    expect(await submitAffiliatePayeeProfile(db, actor, scope, { ...submission, expectedRevision: 1 }, keyring)).toBeNull();
  });
  it("edits revoke exact-revision approval and invalidate pending signed quotes", async () => {
    const f = await fixture(), actor = await grant(f), manager = await grant(f, "owner");
    const scope = { vendorId: f.vendor.id, affiliateId: f.affiliate.id };
    const initial = await submitAffiliatePayeeProfile(db, actor, scope, submission, keyring);
    expect(initial).toEqual({ revision: 1, recipientType: "resident_individual", nhiTreatment: "subject_execution_business", approvedRevision: null });
    expect(await approveAffiliatePayeeProfile(db, manager, scope, 1)).toMatchObject({ approvedRevision: 1 });
    await db.affiliateRemunerationSnapshot.create({ data: { ...f.snapshot, status: "signed", signedByUserId: actor.userId, signedAt: new Date(), profileRevision: 1 } });
    expect(await submitAffiliatePayeeProfile(db, actor, scope, { ...submission, expectedRevision: 1 }, keyring)).toMatchObject({ revision: 2, approvedRevision: null });
    expect(await db.affiliateRemunerationSnapshot.findFirst({ where: scope })).toMatchObject({ status: "invalidated", signedByUserId: actor.userId });
    await expect(approveAffiliatePayeeProfile(db, manager, scope, 1)).rejects.toBeInstanceOf(AffiliatePayeeConflict);
    const stored = await db.affiliatePayeeProfile.findUniqueOrThrow({ where: { vendorId_affiliateId: scope } });
    expect(stored.bankEncrypted).not.toContain("123456789");
    expect(stored.taxIdentityEncrypted).not.toContain("SYNTHETIC123");
  });
  it("concurrent first submissions cannot overwrite each other", async () => {
    const f = await fixture(), actor = await grant(f);
    const scope = { vendorId: f.vendor.id, affiliateId: f.affiliate.id };
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => submitAffiliatePayeeProfile(db, actor, scope, submission, keyring)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) if (result.status === "rejected") expect(result.reason instanceof AffiliatePayeeConflict || ["P2002", "P2034"].includes(result.reason.code)).toBe(true);
    expect(await db.affiliatePayeeProfile.count({ where: scope })).toBe(1);
  });
  it("quotes the immutable ledger with deductions and idempotent signatures", async () => {
    const f = await payableFixture();
    const quote = await createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 });
    expect(quote).toMatchObject({ grossAmountCents: 3_000_000, withholdingTaxCents: 300_000, nhiSupplementaryTaxCents: 63_300, netPayoutAmountCents: 2_635_200, status: "quoted" });
    expect(quote).not.toHaveProperty("bankEncrypted");
    expect(await createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 })).toEqual(quote);
    const signed = await signAffiliateRemunerationQuote(db, f.actor, f.scope, quote!.id, quote!.revision);
    expect(signed).toMatchObject({ status: "signed" });
    expect(await signAffiliateRemunerationQuote(db, f.actor, f.scope, quote!.id, quote!.revision)).toEqual(signed);
  });
  it("refund makes the old quote stale and creates a new exact net quote", async () => {
    const f = await payableFixture();
    const before = await createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 });
    await db.$transaction(tx => appendCommissionLedgerEntry(tx, { ...f.event, eventIdentity: randomUUID(), entryType: "refund", amountCents: -1_500_000 }));
    expect(await signAffiliateRemunerationQuote(db, f.actor, f.scope, before!.id, before!.revision)).toEqual({ status: "stale" });
    expect(await db.affiliateRemunerationSnapshot.findUniqueOrThrow({ where: { id: before!.id } })).toMatchObject({ status: "invalidated" });
    const after = await createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 });
    expect(after).toMatchObject({ revision: 1, grossAmountCents: 1_500_000, withholdingTaxCents: 0, nhiSupplementaryTaxCents: 0, netPayoutAmountCents: 1_498_500 });
  });
  it("rejects foreign and revoked signatures without mutating the owner's quote", async () => {
    const f = await payableFixture(), foreign = await fixture(), stranger = await grant(foreign);
    const quote = await createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 });
    expect(await signAffiliateRemunerationQuote(db, stranger, f.scope, quote!.id, quote!.revision)).toBeNull();
    expect(await createAffiliateRemunerationQuote(db, f.actor, { vendorId: foreign.vendor.id, affiliateId: f.affiliate.id }, f.payout.id, { bankFeeCents: 1500 })).toBeNull();
    await db.affiliatePortalAccess.update({ where: { vendorId_affiliateId: f.scope }, data: { active: false } });
    expect(await signAffiliateRemunerationQuote(db, f.actor, f.scope, quote!.id, quote!.revision)).toBeNull();
    expect(await db.affiliateRemunerationSnapshot.findUniqueOrThrow({ where: { id: quote!.id } })).toMatchObject({ status: "quoted", signedAt: null });
  });
  it("concurrent quote creation produces one current snapshot", async () => {
    const f = await payableFixture();
    const result = await Promise.allSettled(Array.from({ length: 4 }, () => createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 })));
    expect(result.some(item => item.status === "fulfilled")).toBe(true);
    for (const item of result) if (item.status === "rejected") expect(["P2002", "P2034"]).toContain(item.reason.code);
    expect(await db.affiliateRemunerationSnapshot.count({ where: { ...f.scope, payoutId: f.payout.id, status: "quoted" } })).toBe(1);
  });
  it("database rejects immutable quote payload changes and deletion", async () => {
    const f = await payableFixture();
    const quote = await createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 });
    await expect(db.affiliateRemunerationSnapshot.update({ where: { id: quote!.id }, data: { bankEncrypted: "substitution" } })).rejects.toThrow();
    await expect(db.affiliateRemunerationSnapshot.delete({ where: { id: quote!.id } })).rejects.toThrow();
    expect(await db.affiliateRemunerationSnapshot.count({ where: { id: quote!.id } })).toBe(1);
  });
  it("database rejects rewriting signatures or resurrecting invalidated quotes", async () => {
    const f = await payableFixture();
    const quote = await createAffiliateRemunerationQuote(db, f.actor, f.scope, f.payout.id, { bankFeeCents: 1500 });
    await signAffiliateRemunerationQuote(db, f.actor, f.scope, quote!.id, quote!.revision);
    await expect(db.affiliateRemunerationSnapshot.update({ where: { id: quote!.id }, data: { signedByUserId: "another-signer" } })).rejects.toThrow();
    await db.affiliateRemunerationSnapshot.update({ where: { id: quote!.id }, data: { status: "invalidated", invalidatedAt: new Date() } });
    await expect(db.affiliateRemunerationSnapshot.update({ where: { id: quote!.id }, data: { status: "signed", invalidatedAt: null } })).rejects.toThrow();
  });
});
