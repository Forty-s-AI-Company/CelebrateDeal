import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * F-134 / B08-05: shared two-tenant fixture for real-PostgreSQL action tests.
 * Vendor A and vendor B each get one owner, admin, accountant and support
 * member plus a product, order, registration form and submission, sales
 * project, landing page, live, automation rule, sales team and an affiliate
 * with a pending payout. Everything is synthetic and removed with the vendor
 * (rows cascade from Vendor; the users are removed explicitly).
 */
export type TenantRole = "owner" | "admin" | "accountant" | "support";
export const TENANT_ROLES: readonly TenantRole[] = ["owner", "admin", "accountant", "support"];

export type TenantActor = {
  user: { id: string; email: string; name: string; platformRole: string; status: string };
  member: { id: string; vendorId: string; userId: string; role: string; status: string };
  vendor: { id: string; name: string; enabledFeatureModules: string[] };
};

export type TenantData = {
  vendor: TenantActor["vendor"];
  actors: Record<TenantRole, TenantActor>;
  productId: string;
  orderId: string;
  formId: string;
  submissionId: string;
  projectId: string;
  pageId: string;
  liveId: string;
  ruleId: string;
  teamId: string;
  /** Active membership of the owner in `teamId`. */
  ownerTeamMembershipId: string;
  /** Active membership of the support member in `teamId`. */
  supportTeamMembershipId: string;
  affiliateId: string;
  commissionId: string;
  payoutId: string;
  invitationId: string;
};

export type TwoTenantFixture = { a: TenantData; b: TenantData; cleanup: () => Promise<void> };

export function formData(entries: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

/** Fail fast if the run is not connected to the schema the runner declared. */
export async function assertDisposableSchema(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ schema: string }>>`select current_schema() as schema`;
  const expected = process.env.WP18_DISPOSABLE_SCHEMA;
  if (expected && rows[0]?.schema !== expected) {
    throw new Error("[two_tenant_fixture] connected schema does not match WP18_DISPOSABLE_SCHEMA");
  }
}

type Trail = { vendorIds: string[]; userIds: string[] };

async function createTenant(db: PrismaClient, label: string, trail: Trail): Promise<TenantData> {
  const key = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Tenant ${label} ${key.slice(0, 6)}`, slug: `two-tenant-${key}`, email: `${key}@example.test`, passwordHash: "synthetic-only" },
  });
  trail.vendorIds.push(vendor.id);
  const actors = {} as Record<TenantRole, TenantActor>;
  for (const role of TENANT_ROLES) {
    const user = await db.user.create({
      data: { email: `${role}-${key}@example.test`, name: `${label} ${role}`, passwordHash: "synthetic-only" },
    });
    trail.userIds.push(user.id);
    const member = await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role } });
    actors[role] = {
      user: { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole, status: user.status },
      member: { id: member.id, vendorId: vendor.id, userId: user.id, role: member.role, status: member.status },
      vendor: { id: vendor.id, name: vendor.name, enabledFeatureModules: vendor.enabledFeatureModules },
    };
  }

  const project = await db.salesProject.create({
    data: { vendorId: vendor.id, name: `Project ${label}`, slug: key, mode: "live_course", primaryFlow: "live", status: "draft" },
  });
  // Select the project for the owner so project-scoped actions resolve it.
  await db.userOnboardingPreference.create({
    data: { userId: actors.owner.user.id, vendorId: vendor.id, selectedProjectId: project.id },
  });
  const product = await db.product.create({
    data: { vendorId: vendor.id, name: `Product ${label}`, slug: key, priceCents: 1000, inventory: 5 },
  });
  const order = await db.commerceOrder.create({
    data: {
      vendorId: vendor.id,
      projectId: project.id,
      orderNumber: `ORD-${key}`,
      checkoutIdempotencyKey: `idem-${key}`,
      checkoutIdentityHash: createHash("sha256").update(key).digest("base64url"),
      subtotalAmountCents: 1000,
      totalAmountCents: 1000,
      buyerEncryptedEnvelope: "synthetic-envelope",
      buyerMaskedName: "合成買家",
      buyerMaskedEmail: "b***@example.test",
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      projectId: project.id,
      name: `Form ${label}`,
      slug: `form-${key}`,
      headline: "Register",
      fields: [{ key: "name", label: "姓名", type: "text", required: true }],
    },
  });
  const submission = await db.formSubmission.create({
    data: { formId: form.id, name: `${label} 報名者`, email: `lead-${label.toLowerCase()}@example.test`, phone: "0912345678" },
  });
  const page = await db.landingPage.create({
    data: { vendorId: vendor.id, projectId: project.id, name: `Page ${label}`, slug: `page-${key}`, draftContent: {} },
  });
  const live = await db.live.create({
    data: { vendorId: vendor.id, projectId: project.id, title: `Live ${label}`, slug: `live-${key}`, scheduledAt: new Date("2099-01-01T00:00:00.000Z") },
  });
  const rule = await db.automationRule.create({
    data: {
      vendorId: vendor.id,
      funnelPageId: page.id,
      name: `Rule ${label}`,
      trigger: "form_registered",
      condition: { type: "always" },
      actions: [{ type: "add_customer_tag", tag: `tag-${label}` }],
    },
  });

  const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: `Team ${label}`, slug: key } });
  const ownerTeamMembership = await db.teamMembership.create({
    data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: actors.owner.member.id },
  });
  const supportTeamMembership = await db.teamMembership.create({
    data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: actors.support.member.id },
  });

  const affiliate = await db.affiliate.create({
    data: { vendorId: vendor.id, name: `Affiliate ${label}`, code: `AFF-${key}`, commissionRateBps: 1000 },
  });
  const commission = await db.affiliateCommission.create({
    data: {
      vendorId: vendor.id,
      affiliateId: affiliate.id,
      monthKey: "2099-12",
      sourceType: "product",
      referralCode: `AFF-${key}`,
      orderNumber: `AFF-ORDER-${key}`,
      orderAmountCents: 10_000,
      commissionBaseAmountCents: 10_000,
      netReferenceAmountCents: 10_000,
      commissionRateBps: 1000,
      deduplicationKey: `commission-${key}`,
      commissionAmountCents: 750,
      status: "locked",
    },
  });
  await db.affiliateCommissionLedgerEntry.create({
    data: {
      vendorId: vendor.id,
      affiliateCommissionId: commission.id,
      entryType: "accrual",
      deduplicationKey: `ledger-${key}`,
      providerName: "synthetic",
      eventIdentity: `event-${key}`,
      amountCents: 750,
      occurredAt: new Date("2099-12-15T00:00:00.000Z"),
    },
  });
  const payout = await db.affiliatePayout.create({
    data: {
      vendorId: vendor.id,
      affiliateId: affiliate.id,
      monthKey: commission.monthKey,
      commissionAmountCents: 750,
      finalAmountCents: 750,
      status: "pending",
    },
  });
  const invitation = await db.vendorMemberInvitation.create({
    data: {
      vendorId: vendor.id,
      email: `invitee-${key}@example.test`,
      name: `${label} invitee`,
      role: "support",
      tokenHash: createHash("sha256").update(`invitation-${key}`).digest("hex"),
      invitedByUserId: actors.owner.user.id,
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });

  return {
    vendor: actors.owner.vendor,
    actors,
    productId: product.id,
    orderId: order.id,
    formId: form.id,
    submissionId: submission.id,
    projectId: project.id,
    pageId: page.id,
    liveId: live.id,
    ruleId: rule.id,
    teamId: team.id,
    ownerTeamMembershipId: ownerTeamMembership.id,
    supportTeamMembershipId: supportTeamMembership.id,
    affiliateId: affiliate.id,
    commissionId: commission.id,
    payoutId: payout.id,
    invitationId: invitation.id,
  };
}

/** Creates vendors A and B; `cleanup` removes both vendors and their users. */
export async function createTwoTenantFixture(db: PrismaClient): Promise<TwoTenantFixture> {
  await assertDisposableSchema(db);
  // Track ids as they are created so a half-built tenant is still removed.
  const trail: Trail = { vendorIds: [], userIds: [] };
  const cleanup = async () => {
    const vendorIds = trail.vendorIds.splice(0);
    const userIds = trail.userIds.splice(0);
    try {
      await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    } catch (error) {
      // AffiliateCommissionLedgerEntry is append-only and restricts vendor
      // deletion; like the other payout DB tests, the disposable schema is the
      // cleanup boundary for those rows.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003")) throw error;
      return;
    }
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  };
  try {
    const a = await createTenant(db, "A", trail);
    const b = await createTenant(db, "B", trail);
    return { a, b, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
