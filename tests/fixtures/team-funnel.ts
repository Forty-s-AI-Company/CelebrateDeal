import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

/**
 * TEST ONLY: deterministic team-funnel records for browser acceptance.
 *
 * The stable names are intentional so the test asserts visible, meaningful
 * values. `runKey` only namespaces unique database keys for parallel/local
 * executions. Nothing in this module is imported by runtime application code.
 */
export const TEAM_FUNNEL_TEST_ONLY = {
  leader: { name: "TEST ONLY A 領導人", email: "leader-a@team-funnel.test" },
  partner: { name: "TEST ONLY B 夥伴", email: "partner-b@team-funnel.test", affiliateCode: "TESTONLY-B" },
  outsider: { name: "TEST ONLY 跨租戶夥伴", email: "outsider@team-funnel.test" },
  teamName: "TEST ONLY 團隊展業小組",
  seminarTitle: "TEST ONLY A 的研討會",
  productName: "TEST ONLY 原始商品",
  partnerProductUrl: "https://partner.test-only.example/offer",
  templateName: "TEST ONLY 夏季展業模板",
  sourceSlug: "test-only-a-source",
} as const;

export type TeamFunnelFixture = Awaited<ReturnType<typeof createTeamFunnelFixture>>;

export async function createTeamFunnelFixture(db: PrismaClient, runKey: string) {
  const suffix = runKey.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-18);
  const key = `test-only-team-funnel-${suffix}`;
  const password = "TestOnlyTeamFunnel123!";
  const passwordHash = hashPassword(password);

  const leaderVendor = await db.vendor.create({
    data: {
      name: "TEST ONLY A 公司",
      slug: `${key}-a`,
      email: `vendor-a-${suffix}@team-funnel.test`,
      passwordHash,
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      timezone: "Asia/Taipei",
      tracking: { create: {} },
    },
  });
  const leader = await db.user.create({
    data: {
      name: TEAM_FUNNEL_TEST_ONLY.leader.name,
      email: `leader-a-${suffix}@team-funnel.test`,
      passwordHash,
      status: "active",
      memberships: { create: { vendorId: leaderVendor.id, role: "editor", status: "active" } },
    },
    include: { memberships: true },
  });
  const partner = await db.user.create({
    data: {
      name: TEAM_FUNNEL_TEST_ONLY.partner.name,
      email: `partner-b-${suffix}@team-funnel.test`,
      passwordHash,
      status: "active",
      memberships: { create: { vendorId: leaderVendor.id, role: "editor", status: "active" } },
    },
    include: { memberships: true },
  });
  const team = await db.salesTeam.create({
    data: { vendorId: leaderVendor.id, name: TEAM_FUNNEL_TEST_ONLY.teamName, slug: `${key}-team` },
  });
  const affiliate = await db.affiliate.create({
    data: {
      vendorId: leaderVendor.id,
      name: TEAM_FUNNEL_TEST_ONLY.partner.name,
      code: `${TEAM_FUNNEL_TEST_ONLY.partner.affiliateCode}-${suffix}`.toUpperCase(),
      commissionRateBps: 0,
      isActive: true,
    },
  });
  const leaderMembership = await db.teamMembership.create({
    data: { vendorId: leaderVendor.id, teamId: team.id, vendorMemberId: leader.memberships[0]!.id },
  });
  const partnerMembership = await db.teamMembership.create({
    data: { vendorId: leaderVendor.id, teamId: team.id, vendorMemberId: partner.memberships[0]!.id, affiliateId: affiliate.id },
  });
  await db.teamMembershipRelationship.create({
    data: { teamId: team.id, uplineMembershipId: leaderMembership.id, downlineMembershipId: partnerMembership.id },
  });
  const product = await db.product.create({
    data: {
      vendorId: leaderVendor.id,
      name: TEAM_FUNNEL_TEST_ONLY.productName,
      slug: `${key}-product`,
      priceCents: 6800,
      currency: "TWD",
      inventory: 100,
      isActive: true,
      checkoutUrl: "https://product.test-only.example/default",
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: leaderVendor.id,
      name: "TEST ONLY 報名表",
      slug: `${key}-form`,
      headline: "TEST ONLY 研討會報名",
      submitLabel: "TEST ONLY 送出報名",
      successMessage: "TEST ONLY 已收到報名",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const seminar = await db.live.create({
    data: {
      vendorId: leaderVendor.id,
      teamId: team.id,
      seminarOwnerMembershipId: leaderMembership.id,
      formId: form.id,
      title: TEAM_FUNNEL_TEST_ONLY.seminarTitle,
      slug: `${key}-seminar`,
      scheduledAt: new Date("2030-08-01T02:00:00.000Z"),
      status: "scheduled",
    },
  });

  // This separate source/version/share is deliberately expired. It gives the
  // browser suite a deterministic rejection scenario without contaminating
  // the A-created template used for the happy-path acceptance journey.
  const expiredTemplate = await db.teamFunnelTemplate.create({
    data: {
      vendorId: leaderVendor.id,
      teamId: team.id,
      name: "TEST ONLY 過期分享模板",
      status: "ACTIVE",
      versions: {
        create: {
          vendorId: leaderVendor.id,
          version: 1,
          contentOwnerMembershipId: leaderMembership.id,
          createdByMemberId: leader.memberships[0]!.id,
          headline: "TEST ONLY 過期模板",
          body: "TEST ONLY 過期分享情境",
          ctaLabel: "TEST ONLY CTA",
          productSlots: { create: { productId: product.id, slotKey: "main_product" } },
        },
      },
    },
    include: { versions: true },
  });
  const expiredSourcePage = await db.partnerFunnelPage.create({
    data: {
      vendorId: leaderVendor.id,
      teamId: team.id,
      templateVersionId: expiredTemplate.versions[0]!.id,
      promoterMembershipId: leaderMembership.id,
      contentOwnerMembershipId: leaderMembership.id,
      liveId: seminar.id,
      slug: `${key}-expired-source`,
      headline: "TEST ONLY 過期模板",
      body: "TEST ONLY 過期分享情境",
      ctaLabel: "TEST ONLY CTA",
    },
  });
  const expiredShareCode = `tf1.${Buffer.from(JSON.stringify({ v: 1, audience: { type: "DIRECT_DOWNLINE" } })).toString("base64url")}.${"x".repeat(43)}`;
  await db.partnerFunnelPageShareSetting.create({
    data: {
      pageId: expiredSourcePage.id,
      accessMode: "TOKEN_REQUIRED",
      tokenHash: createHash("sha256").update(expiredShareCode, "utf8").digest("hex"),
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      isEnabled: true,
    },
  });

  const outsiderVendor = await db.vendor.create({
    data: {
      name: "TEST ONLY 跨租戶公司",
      slug: `${key}-other`,
      email: `vendor-other-${suffix}@team-funnel.test`,
      passwordHash,
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: { create: {} },
    },
  });
  const outsider = await db.user.create({
    data: {
      name: TEAM_FUNNEL_TEST_ONLY.outsider.name,
      email: `outsider-${suffix}@team-funnel.test`,
      passwordHash,
      status: "active",
      memberships: { create: { vendorId: outsiderVendor.id, role: "editor", status: "active" } },
    },
  });

  return {
    password,
    leader: { userId: leader.id, email: leader.email, vendorId: leaderVendor.id, membershipId: leaderMembership.id },
    partner: { userId: partner.id, email: partner.email, vendorId: leaderVendor.id, membershipId: partnerMembership.id, affiliateCode: affiliate.code },
    outsider: { userId: outsider.id, email: outsider.email, vendorId: outsiderVendor.id },
    team,
    product,
    form,
    seminar,
    expiredSharePath: `/team-template?share=${encodeURIComponent(expiredShareCode)}`,
    expiredScenario: { templateId: expiredTemplate.id, versionId: expiredTemplate.versions[0]!.id, pageId: expiredSourcePage.id },
    /** The browser creates the original page/template versions and live share. */
    scenario: { templateName: TEAM_FUNNEL_TEST_ONLY.templateName, sourceSlug: `${TEAM_FUNNEL_TEST_ONLY.sourceSlug}-${suffix}` },
    async cleanup() {
      // TEST ONLY: deleting the two tenant roots cascades solely to these fixture records.
      await db.vendor.deleteMany({ where: { id: { in: [leaderVendor.id, outsiderVendor.id] } } });
      await db.user.deleteMany({ where: { id: { in: [leader.id, partner.id, outsider.id] } } });
    },
  };
}
