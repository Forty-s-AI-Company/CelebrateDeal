import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ database: null as unknown, auth: null as unknown }));
vi.mock("@/lib/db", () => ({ getDb: () => runtime.database }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: async () => runtime.auth }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import { deactivateTeamMembershipAction, setTeamMembershipAffiliateAction, transferTeamMemberAction } from "./team-membership-actions";
import { createReservedPaymentTransaction } from "@/lib/inventory-reservations";
import { createCommerceOrderForCheckout, reconcileCommerceOrderPaymentTransition } from "@/lib/commerce-orders";
import { accrueMerchantAffiliatePlan, freezeMerchantAffiliateCheckout, publishMerchantAffiliatePolicy } from "@/lib/merchant-affiliate-policy-service";

// Actual PostgreSQL writes; only the request/session boundary is synthetic.
// Commission ledgers are append-only, so rows stay until the disposable
// database is destroyed (same contract as merchant-affiliate-policy.db.test).
const db = new PrismaClient();
runtime.database = db;
afterAll(async () => db.$disconnect());

type Tenant = Awaited<ReturnType<typeof tenant>>;

async function tenant() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic team binding", slug: `bind-${id}`, email: `${id}@example.test`, passwordHash: "synthetic-only", enabledFeatureModules: ["affiliate_program"] } });
  const owner = await db.user.create({ data: { name: "Synthetic owner", email: `owner-${id}@example.test`, passwordHash: "synthetic-only", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } }, include: { memberships: true } });
  const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: "Synthetic team", slug: id } });
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic physical", slug: id, priceCents: 1000, currency: "TWD", inventory: 10, isActive: true, fulfillmentTypeConfirmed: true, commerceDomain: "merchant", fulfillmentType: "physical" } });
  const member = async (label: string) => {
    const user = await db.user.create({ data: { name: `Synthetic ${label}`, email: `${label}-${id}@example.test`, passwordHash: "synthetic-only", memberships: { create: { vendorId: vendor.id, role: "partner", status: "active" } } }, include: { memberships: true } });
    const membership = await db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: user.memberships[0]!.id } });
    const affiliate = await db.affiliate.create({ data: { vendorId: vendor.id, name: `Synthetic ${label}`, code: `${label.toUpperCase()}-${id}`.slice(0, 40), contactEmail: `${label}-${id}@example.test` } });
    return { membership, affiliate };
  };
  return {
    vendor, team, product, member,
    actor: { vendorId: vendor.id, userId: owner.id },
    auth: { user: { id: owner.id }, vendor: { id: vendor.id }, member: { id: owner.memberships[0]!.id, role: "owner" } },
  };
}

function bindForm(membershipId: string, affiliateId: string | null) {
  const form = new FormData();
  form.set("membershipId", membershipId);
  form.set("affiliateId", affiliateId ?? "");
  return form;
}

async function bind(as: Tenant, membershipId: string, affiliateId: string | null) {
  runtime.auth = as.auth;
  return setTeamMembershipAffiliateAction(bindForm(membershipId, affiliateId)).then(
    () => { throw new Error("action must redirect"); },
    (error: Error) => error.message,
  );
}

/** Runs a redirecting action as the given owner and returns the redirect target. */
async function run(as: Tenant, action: (form: FormData) => Promise<unknown>, fields: Record<string, string>) {
  runtime.auth = as.auth;
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return action(form).then(
    () => { throw new Error("action must redirect"); },
    (error: Error) => error.message,
  );
}

type CommissionRow = { merchantLevel: number | null; affiliateId: string | null; commissionAmountCents: number };
const summary = (rows: CommissionRow[]) => rows.map(row => [row.merchantLevel, row.affiliateId, row.commissionAmountCents]);

async function linkUpline(t: Tenant, uplineMembershipId: string, downlineMembershipId: string) {
  await db.teamMembershipRelationship.create({ data: { teamId: t.team.id, uplineMembershipId, downlineMembershipId, effectiveAt: new Date("2026-01-01T00:00:00Z") } });
}

/** Mirrors the checkout route: the verified referral code is frozen into the
 * server-created transaction metadata and the commission snapshot together. */
async function checkout(t: Tenant, affiliate: { id: string; code: string }) {
  const key = randomUUID();
  return createReservedPaymentTransaction({ vendorId: t.vendor.id, productId: t.product.id, checkoutIdempotencyKey: key,
    transactionData: { vendorId: t.vendor.id, providerName: "demo", orderNumber: key, checkoutIdempotencyKey: key, grossAmountCents: 900, netAmountCents: 900, currency: "TWD", status: "pending", metadata: { productId: t.product.id, referralCode: affiliate.code } },
    createCommerceOrder: async (tx, payment) => {
      const order = await createCommerceOrderForCheckout(tx, { vendorId: t.vendor.id, productId: t.product.id, orderNumber: key, checkoutIdempotencyKey: key, paymentTransactionId: payment.id, totalAmountCents: 900, discountAmountCents: 100, currency: "TWD", buyer: { name: "Synthetic buyer", email: "buyer@example.test", phone: "0912345678" }, shipping: { recipientName: "Synthetic buyer", phone: "0912345678", countryCode: "TW", postalCode: "100", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成測試路 1 號" } });
      await freezeMerchantAffiliateCheckout(tx, { vendorId: t.vendor.id, orderId: order.id, transactionId: payment.id, affiliateId: affiliate.id, referralCode: affiliate.code });
    } });
}

async function pay(t: Tenant, paymentId: string) {
  const occurredAt = new Date("2026-10-06T00:00:00Z");
  return db.$transaction(async tx => {
    await tx.paymentTransaction.update({ where: { id: paymentId }, data: { status: "paid" } });
    await reconcileCommerceOrderPaymentTransition(tx, { vendorId: t.vendor.id, paymentTransactionId: paymentId, transition: "paid", eventIdentity: `paid:${paymentId}`, occurredAt });
    return accrueMerchantAffiliatePlan(tx, { vendorId: t.vendor.id, transactionId: paymentId, providerName: "demo", occurredAt });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const tiers = [{ minQuantity: 1, maxQuantity: null, rateBps: 1000 }];
const policy = (uplines: Array<{ level: number; rateBps: number }>) => ({ schemaVersion: 1, currency: "TWD", maxTotalBps: 10000, tiers, uplines, productOverrides: [] });

beforeEach(() => { runtime.database = db; });

describe("team membership affiliate binding on PostgreSQL", () => {
  it("binds both members so a downline's paid order pays the bound upline with the order's referral code", async () => {
    const t = await tenant(), a = await t.member("a"), b = await t.member("b");
    await linkUpline(t, a.membership.id, b.membership.id);

    expect(await bind(t, a.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    expect(await bind(t, b.membership.id, b.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ affiliateId: a.affiliate.id });
    const audit = await db.auditLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, targetId: a.membership.id, action: "bind_team_membership_affiliate" } });
    expect(audit).toMatchObject({
      actorId: t.actor.userId,
      targetType: "TeamMembership",
      before: { membershipId: a.membership.id, teamId: t.team.id, affiliateId: null },
      after: { membershipId: a.membership.id, teamId: t.team.id, affiliateId: a.affiliate.id },
    });

    await publishMerchantAffiliatePolicy(db, t.actor, { terms: policy([{ level: 1, rateBps: 200 }]), expectedRevision: 0 });
    const payment = await checkout(t, b.affiliate);
    const result = await pay(t, payment.id);

    expect(result!.commissions.map(row => ({ level: row.merchantLevel, affiliateId: row.affiliateId, amount: row.commissionAmountCents, rate: row.commissionRateBps, referralCode: row.referralCode }))).toEqual([
      { level: 0, affiliateId: b.affiliate.id, amount: 90, rate: 1000, referralCode: b.affiliate.code },
      { level: 1, affiliateId: a.affiliate.id, amount: 18, rate: 200, referralCode: b.affiliate.code },
    ]);
    // A later code edit cannot rewrite which code this order used.
    await db.affiliate.update({ where: { id: b.affiliate.id }, data: { code: randomUUID() } });
    const replay = await pay(t, payment.id);
    expect(replay!.commissions.map(row => row.referralCode)).toEqual([b.affiliate.code, b.affiliate.code]);
  });

  it("rejects binding a foreign affiliate and editing another vendor's membership", async () => {
    const x = await tenant(), y = await tenant(), xa = await x.member("xa"), ya = await y.member("ya");
    await db.teamMembership.update({ where: { id: ya.membership.id }, data: { affiliateId: ya.affiliate.id } });

    expect(await bind(x, xa.membership.id, ya.affiliate.id)).toBe("redirect:/settings/team?error=affiliate_invalid");
    expect(await bind(x, ya.membership.id, xa.affiliate.id)).toBe("redirect:/settings/team?error=membership_invalid");
    expect(await bind(x, ya.membership.id, null)).toBe("redirect:/settings/team?error=membership_invalid");

    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: xa.membership.id } })).toMatchObject({ affiliateId: null });
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: ya.membership.id } })).toMatchObject({ affiliateId: ya.affiliate.id });
    expect(await db.auditLog.count({ where: { targetId: { in: [xa.membership.id, ya.membership.id] } } })).toBe(0);
  });

  it("rejects binding an affiliate that already holds another membership, including concurrent attempts", async () => {
    const t = await tenant(), a = await t.member("a"), b = await t.member("b"), c = await t.member("c");

    expect(await bind(t, a.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    expect(await bind(t, b.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?error=affiliate_taken");
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ affiliateId: a.affiliate.id });
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: b.membership.id } })).toMatchObject({ affiliateId: null });

    await db.affiliate.update({ where: { id: c.affiliate.id }, data: { isActive: false } });
    expect(await bind(t, b.membership.id, c.affiliate.id)).toBe("redirect:/settings/team?error=affiliate_inactive");
    await db.affiliate.update({ where: { id: c.affiliate.id }, data: { isActive: true } });

    runtime.auth = t.auth;
    const outcomes = await Promise.all([b.membership.id, c.membership.id].map(membershipId =>
      setTeamMembershipAffiliateAction(bindForm(membershipId, c.affiliate.id)).catch((error: Error) => error.message)));
    expect(outcomes.filter(outcome => outcome === "redirect:/settings/team?updated=affiliate_bound")).toHaveLength(1);
    for (const outcome of outcomes.filter(value => value !== "redirect:/settings/team?updated=affiliate_bound")) {
      expect(["redirect:/settings/team?error=affiliate_taken", "redirect:/settings/team?error=affiliate_binding_conflict"]).toContain(outcome);
    }
    expect(await db.teamMembership.count({ where: { vendorId: t.vendor.id, affiliateId: c.affiliate.id } })).toBe(1);
  });

  it("stops paying an unbound upline on new checkouts without compressing the next level", async () => {
    const t = await tenant(), g = await t.member("g"), a = await t.member("a"), b = await t.member("b");
    await linkUpline(t, g.membership.id, a.membership.id);
    await linkUpline(t, a.membership.id, b.membership.id);
    for (const person of [g, a, b]) expect(await bind(t, person.membership.id, person.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    await publishMerchantAffiliatePolicy(db, t.actor, { terms: policy([{ level: 1, rateBps: 200 }, { level: 2, rateBps: 100 }]), expectedRevision: 0 });

    const frozenBefore = await checkout(t, b.affiliate);
    expect(await bind(t, a.membership.id, null)).toBe("redirect:/settings/team?updated=affiliate_unbound");
    expect(await db.auditLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, targetId: a.membership.id, action: "unbind_team_membership_affiliate" } })).toMatchObject({
      before: { affiliateId: a.affiliate.id },
      after: { affiliateId: null },
    });
    const after = await checkout(t, b.affiliate);

    // A checkout frozen before the change keeps its original beneficiaries.
    expect(summary((await pay(t, frozenBefore.id))!.commissions)).toEqual([[0, b.affiliate.id, 90], [1, a.affiliate.id, 18], [2, g.affiliate.id, 9]]);
    // The new checkout leaves level 1 empty; G stays at level 2.
    expect(summary((await pay(t, after.id))!.commissions)).toEqual([[0, b.affiliate.id, 90], [2, g.affiliate.id, 9]]);
    const snapshot = await db.merchantAffiliateCheckoutSnapshot.findFirstOrThrow({ where: { vendorId: t.vendor.id, paymentTransactionId: after.id }, include: { recipients: { orderBy: { level: "asc" } } } });
    expect(snapshot.recipients.map(row => [row.level, row.affiliateId])).toEqual([[0, b.affiliate.id], [2, g.affiliate.id]]);
  });

  it.each(["affiliate", "member", "user"] as const)("leaves level 1 vacant and still pays level 2 when the upline %s is deactivated", async (mode) => {
    const t = await tenant(), g = await t.member("g"), a = await t.member("a"), b = await t.member("b");
    await linkUpline(t, g.membership.id, a.membership.id);
    await linkUpline(t, a.membership.id, b.membership.id);
    for (const person of [g, a, b]) expect(await bind(t, person.membership.id, person.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    await publishMerchantAffiliatePolicy(db, t.actor, { terms: policy([{ level: 1, rateBps: 200 }, { level: 2, rateBps: 100 }]), expectedRevision: 0 });

    // The membership and its relationships stay ACTIVE; only availability changes.
    const vendorMember = await db.vendorMember.findUniqueOrThrow({ where: { id: a.membership.vendorMemberId } });
    if (mode === "affiliate") await db.affiliate.update({ where: { id: a.affiliate.id }, data: { isActive: false } });
    if (mode === "member") await db.vendorMember.update({ where: { id: vendorMember.id }, data: { status: "inactive" } });
    if (mode === "user") await db.user.update({ where: { id: vendorMember.userId }, data: { status: "disabled" } });

    const payment = await checkout(t, b.affiliate);
    expect(summary((await pay(t, payment.id))!.commissions)).toEqual([[0, b.affiliate.id, 90], [2, g.affiliate.id, 9]]);
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ status: "ACTIVE", affiliateId: a.affiliate.id });
  });

  it("moves the binding with a transferred member under the real unique index and keeps frozen checkouts", async () => {
    const t = await tenant(), u = await t.member("u"), a = await t.member("a");
    const otherTeam = await db.salesTeam.create({ data: { vendorId: t.vendor.id, name: "Synthetic second team", slug: randomUUID() } });
    await linkUpline(t, u.membership.id, a.membership.id);
    for (const person of [u, a]) expect(await bind(t, person.membership.id, person.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    await publishMerchantAffiliatePolicy(db, t.actor, { terms: policy([{ level: 1, rateBps: 200 }]), expectedRevision: 0 });
    const frozen = await checkout(t, a.affiliate);

    expect(await run(t, transferTeamMemberAction, { sourceTeamId: t.team.id, targetTeamId: otherTeam.id, membershipId: a.membership.id })).toBe("redirect:/settings/team?updated=member_transferred");
    const moved = await db.teamMembership.findFirstOrThrow({ where: { teamId: otherTeam.id, vendorMemberId: a.membership.vendorMemberId } });
    expect(moved).toMatchObject({ status: "ACTIVE", affiliateId: a.affiliate.id });
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ status: "INACTIVE", affiliateId: null });
    expect(await db.auditLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, targetId: moved.id, action: "transfer_team_member" } })).toMatchObject({
      before: { sourceMembershipId: a.membership.id, sourceAffiliateId: a.affiliate.id, targetMembershipId: null, targetAffiliateId: null },
      after: { sourceMembershipId: a.membership.id, targetMembershipId: moved.id, affiliateId: a.affiliate.id },
    });

    // The checkout frozen before the move still pays the original upline.
    expect(summary((await pay(t, frozen.id))!.commissions)).toEqual([[0, a.affiliate.id, 90], [1, u.affiliate.id, 18]]);
    // A new checkout follows the new team, where A has no upline.
    expect(summary((await pay(t, (await checkout(t, a.affiliate)).id))!.commissions)).toEqual([[0, a.affiliate.id, 90]]);

    // Moving back reactivates the original record and reclaims the binding.
    expect(await run(t, transferTeamMemberAction, { sourceTeamId: otherTeam.id, targetTeamId: t.team.id, membershipId: moved.id })).toBe("redirect:/settings/team?updated=member_transferred");
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ status: "ACTIVE", affiliateId: a.affiliate.id });
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({ status: "INACTIVE", affiliateId: null });
    expect(await db.auditLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, targetId: a.membership.id, action: "transfer_team_member" } })).toMatchObject({
      before: { sourceMembershipId: moved.id, sourceAffiliateId: a.affiliate.id, targetMembershipId: a.membership.id, targetAffiliateId: null },
    });
  });

  it("rebinds an already bound membership to another affiliate and frees the previous one", async () => {
    const t = await tenant(), a = await t.member("a"), b = await t.member("b"), spare = await t.member("spare");

    expect(await bind(t, a.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    expect(await bind(t, a.membership.id, spare.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ affiliateId: spare.affiliate.id });
    const rebinds = await db.auditLog.findMany({ where: { vendorId: t.vendor.id, targetId: a.membership.id, action: "bind_team_membership_affiliate" } });
    expect(rebinds.map(row => [(row.before as { affiliateId: string | null }).affiliateId, (row.after as { affiliateId: string | null }).affiliateId])).toEqual(expect.arrayContaining([
      [null, a.affiliate.id],
      [a.affiliate.id, spare.affiliate.id],
    ]));
    expect(rebinds).toHaveLength(2);
    expect(await bind(t, a.membership.id, spare.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_unchanged");
    expect(await bind(t, b.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
  });

  it("releases the binding on deactivation and only allows releasing a stale binding on an inactive record", async () => {
    const t = await tenant(), a = await t.member("a"), b = await t.member("b");
    expect(await bind(t, a.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");

    expect(await run(t, deactivateTeamMembershipAction, { teamId: t.team.id, membershipId: a.membership.id })).toBe("redirect:/settings/team?updated=member_deactivated");
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ status: "INACTIVE", affiliateId: null });
    expect(await db.auditLog.findFirstOrThrow({ where: { vendorId: t.vendor.id, targetId: a.membership.id, action: "deactivate_team_membership" } })).toMatchObject({
      before: { status: "ACTIVE", affiliateId: a.affiliate.id },
      after: { status: "INACTIVE", affiliateId: null },
    });

    // A stale binding on an inactive record (e.g. written before this release rule).
    await db.teamMembership.update({ where: { id: a.membership.id }, data: { affiliateId: a.affiliate.id } });
    expect(await bind(t, b.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?error=affiliate_taken_inactive");
    expect(await bind(t, a.membership.id, b.affiliate.id)).toBe("redirect:/settings/team?error=membership_invalid");
    expect(await bind(t, a.membership.id, null)).toBe("redirect:/settings/team?updated=affiliate_unbound");
    expect(await db.teamMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).toMatchObject({ status: "INACTIVE", affiliateId: null });
    expect(await bind(t, b.membership.id, a.affiliate.id)).toBe("redirect:/settings/team?updated=affiliate_bound");
  });
});
