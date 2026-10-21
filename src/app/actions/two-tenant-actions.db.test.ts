import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTwoTenantFixture,
  formData,
  type TenantActor,
  type TenantData,
  type TwoTenantFixture,
} from "@/test/two-tenant-fixture";

// F-134 / B08-05: table-driven second-tenant matrix on real PostgreSQL. Only the
// session, CSRF, rate-limit, mail and navigation boundaries are synthetic; every
// query the actions run hits the actual schema. Each "foreign" row is performed by
// a tenant-A actor carrying tenant-B identifiers (or a forged cross-tenant
// context) and must be refused with no write on either tenant. Each "own" row is
// the same action with tenant-A identifiers and must go through.
const runtime = vi.hoisted(() => ({ actor: null as unknown }));
const mocks = vi.hoisted(() => ({
  sendPasswordResetLink: vi.fn(),
  sendInvitationEmail: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()), cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
  notFound: (): never => {
    throw new Error("not_found");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/recent-mfa", () => ({ requireRecentMfa: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/account-rate-limit", () => ({ checkAccountRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/email", () => ({ sendVendorMemberInvitationEmail: mocks.sendInvitationEmail }));
vi.mock("@/lib/password-reset", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/password-reset")>()),
  sendPasswordResetLink: mocks.sendPasswordResetLink,
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  const current = () => runtime.actor as TenantActor;
  return {
    ...original,
    requireVendorOwner: async () => ({ user: current().user, vendor: current().vendor, member: current().member, session: {} }),
    requireVendorFinance: async () => ({ user: current().user, vendor: current().vendor, member: current().member, session: {} }),
    requireVendorManager: async () => current().vendor,
    requireVendorManagerContext: async () => ({ auth: { user: current().user, member: current().member }, vendor: current().vendor }),
  };
});

import { recordAffiliatePayoutOutcomeAction } from "@/app/actions";
import {
  createFunnelAutomationRuleAction,
  listFunnelAutomationRulesAction,
  setFunnelAutomationRuleEnabledAction,
  updateFunnelAutomationRuleAction,
} from "./funnel-automation-actions";
import { searchFormSubmissionsAction } from "./form-submission-search-actions";
import { saveMerchantAffiliatePayoutPolicyAction } from "./merchant-affiliate-payout-policy-actions";
import {
  addTeamMemberAction,
  deactivateTeamMembershipAction,
  setTeamUplineAction,
  transferTeamMemberAction,
} from "./team-membership-actions";
import {
  changeVendorMemberRoleAction,
  createVendorMemberAction,
  deactivateVendorMemberAction,
  resendVendorMemberInvitationAction,
  revokeVendorMemberInvitationAction,
} from "./vendor-member-actions";

const db = new PrismaClient();
let fixture: TwoTenantFixture;
let extraTeamId = "";
let extraTeamIdB = "";

/** Everything the matrix could write, per tenant, as comparable JSON. */
async function snapshot(vendorId: string) {
  const byVendor = { where: { vendorId }, orderBy: { id: "asc" as const } };
  return JSON.stringify([
    await db.vendorMember.findMany(byVendor),
    await db.vendorMemberInvitation.findMany(byVendor),
    await db.salesTeam.findMany(byVendor),
    await db.teamMembership.findMany(byVendor),
    await db.teamMembershipRelationship.findMany({ where: { team: { vendorId } }, orderBy: { id: "asc" } }),
    await db.affiliatePayout.findMany(byVendor),
    await db.affiliateCommission.findMany(byVendor),
    await db.affiliateCommissionLedgerEntry.findMany(byVendor),
    await db.automationRule.findMany(byVendor),
    await db.merchantAffiliatePayoutPolicy.findMany({ where: { vendorId } }),
    await db.registrationForm.findMany(byVendor),
    await db.formSubmission.findMany({ where: { form: { vendorId } }, orderBy: { id: "asc" } }),
    await db.userSession.findMany({ where: { vendorId }, orderBy: { id: "asc" } }),
    await db.auditLog.count({ where: { vendorId } }),
  ]);
}

/** A server action ends in `redirect()` (thrown) or returns a state object. */
async function outcome(run: () => Promise<unknown>) {
  try {
    const value = await run();
    if (value && typeof value === "object" && "status" in value) {
      const state = value as { status: string; message: string; result?: { items?: unknown[] } | null; rules?: unknown[] };
      return `state:${state.status}:${state.message}`;
    }
    return `value:${JSON.stringify(value)}`;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("redirect:")) return error.message;
    if (error instanceof Error && error.message === "not_found") return "not_found";
    throw error;
  }
}

type Fix = { a: TenantData; b: TenantData; extraTeamId: string; extraTeamIdB: string };
type Row = {
  name: string;
  actor: (f: Fix) => TenantActor;
  form: (f: Fix) => FormData;
  run: (form: FormData) => Promise<unknown>;
  /** Substring that the redirect URL or state message must contain. */
  expected: string;
  /** Own-tenant rows only: extra assertions on the tenant-A rows. */
  verify?: (f: Fix) => Promise<void>;
};

const owner = (tenant: (f: Fix) => TenantData) => (f: Fix) => tenant(f).actors.owner;
const a = (f: Fix) => f.a;
const b = (f: Fix) => f.b;

const payoutForm = (id: string) => formData({ id, status: "void", reason: "synthetic void" });
const ruleForm = (pageId: string, ruleId: string, version = "1") => formData({ pageId, ruleId, version, name: "改名", tag: "新標籤" });

const foreignRows: Row[] = [
  // 1. vendor-member-actions
  {
    name: "vendor member: invitation for an address that already belongs to tenant B stays tenant A only",
    actor: owner(a),
    form: (f) => formData({ email: f.b.actors.support.user.email, name: "外部成員", role: "support" }),
    run: createVendorMemberAction,
    expected: "updated=member_invited",
  },
  {
    name: "vendor member: revoke tenant B's invitation",
    actor: owner(a),
    form: (f) => formData({ invitationId: f.b.invitationId }),
    run: revokeVendorMemberInvitationAction,
    expected: "error=member_invitation_not_found",
  },
  {
    name: "vendor member: resend for tenant B's member",
    actor: owner(a),
    form: (f) => formData({ id: f.b.actors.accountant.member.id }),
    run: resendVendorMemberInvitationAction,
    expected: "error=member_invitation_resend_invalid",
  },
  {
    name: "vendor member: change the role of tenant B's admin",
    actor: owner(a),
    form: (f) => formData({ id: f.b.actors.admin.member.id, role: "accountant" }),
    run: changeVendorMemberRoleAction,
    expected: "error=member_not_found",
  },
  {
    name: "vendor member: deactivate tenant B's support member with the right confirmation",
    actor: owner(a),
    form: (f) => formData({ id: f.b.actors.support.member.id, confirmation: f.b.actors.support.user.email }),
    run: deactivateVendorMemberAction,
    expected: "error=member_not_found",
  },
  // 2. team-membership-actions
  {
    name: "team: add tenant A's member to tenant B's team",
    actor: owner(a),
    form: (f) => formData({ teamId: f.b.teamId, vendorMemberId: f.a.actors.admin.member.id }),
    run: addTeamMemberAction,
    expected: "error=team_invalid",
  },
  {
    name: "team: add tenant B's member to tenant A's team",
    actor: owner(a),
    form: (f) => formData({ teamId: f.a.teamId, vendorMemberId: f.b.actors.admin.member.id }),
    run: addTeamMemberAction,
    expected: "error=member_invalid",
  },
  {
    name: "team: transfer tenant B's membership between tenant B's teams",
    actor: owner(a),
    form: (f) => formData({ sourceTeamId: f.b.teamId, targetTeamId: f.extraTeamIdB, membershipId: f.b.supportTeamMembershipId }),
    run: transferTeamMemberAction,
    expected: "error=membership_invalid",
  },
  {
    name: "team: transfer tenant A's membership into tenant B's team",
    actor: owner(a),
    form: (f) => formData({ sourceTeamId: f.a.teamId, targetTeamId: f.b.teamId, membershipId: f.a.supportTeamMembershipId }),
    run: transferTeamMemberAction,
    expected: "error=team_invalid",
  },
  {
    name: "team: set an upline inside tenant B's team",
    actor: owner(a),
    form: (f) => formData({ teamId: f.b.teamId, downlineMembershipId: f.b.supportTeamMembershipId, uplineMembershipId: f.b.ownerTeamMembershipId }),
    run: setTeamUplineAction,
    expected: "error=membership_invalid",
  },
  {
    name: "team: make tenant B's membership the upline of tenant A's",
    actor: owner(a),
    form: (f) => formData({ teamId: f.a.teamId, downlineMembershipId: f.a.supportTeamMembershipId, uplineMembershipId: f.b.ownerTeamMembershipId }),
    run: setTeamUplineAction,
    expected: "error=upline_invalid",
  },
  {
    name: "team: deactivate tenant B's membership",
    actor: owner(a),
    form: (f) => formData({ teamId: f.b.teamId, membershipId: f.b.supportTeamMembershipId }),
    run: deactivateTeamMembershipAction,
    expected: "error=membership_invalid",
  },
  {
    name: "team: deactivate tenant B's membership through tenant A's team id",
    actor: owner(a),
    form: (f) => formData({ teamId: f.a.teamId, membershipId: f.b.supportTeamMembershipId }),
    run: deactivateTeamMembershipAction,
    expected: "error=membership_invalid",
  },
  // 3. merchant-affiliate-payout-policy-actions
  {
    name: "payout policy: tenant A cannot reuse tenant B's policy revision",
    actor: owner(a),
    form: () => formData({ expectedRevision: "1", bankFeeCents: "1", enabled: "on" }),
    run: saveMerchantAffiliatePayoutPolicyAction,
    expected: "error=conflict",
  },
  {
    name: "payout policy: tenant B's owner forged into tenant A's context",
    actor: (f) => ({ ...f.b.actors.owner, vendor: f.a.vendor }),
    form: () => formData({ expectedRevision: "0", bankFeeCents: "1", enabled: "on" }),
    run: saveMerchantAffiliatePayoutPolicyAction,
    expected: "error=conflict",
  },
  {
    name: "payout policy: an accountant of tenant A is not a policy manager",
    actor: (f) => f.a.actors.accountant,
    form: () => formData({ expectedRevision: "0", bankFeeCents: "1", enabled: "on" }),
    run: saveMerchantAffiliatePayoutPolicyAction,
    expected: "error=conflict",
  },
  // 4. recordAffiliatePayoutOutcomeAction
  {
    name: "payout outcome: void tenant B's payout",
    actor: (f) => f.a.actors.accountant,
    form: (f) => payoutForm(f.b.payoutId),
    run: recordAffiliatePayoutOutcomeAction,
    expected: "/affiliates/commissions?error=conflict",
  },
  {
    name: "payout outcome: tenant B's accountant cannot settle tenant A's payout",
    actor: (f) => ({ ...f.b.actors.accountant, vendor: f.a.vendor }),
    form: (f) => payoutForm(f.a.payoutId),
    run: recordAffiliatePayoutOutcomeAction,
    expected: "/affiliates/commissions?error=conflict",
  },
  // 5. funnel-automation-actions
  {
    name: "funnel automation: list rules of tenant B's page",
    actor: owner(a),
    form: (f) => formData({ pageId: f.b.pageId }),
    run: listFunnelAutomationRulesAction,
    expected: "state:error:找不到這個漏斗或規則",
  },
  {
    name: "funnel automation: create a rule on tenant B's page",
    actor: owner(a),
    form: (f) => formData({ pageId: f.b.pageId, name: "新規則", tag: "標籤" }),
    run: createFunnelAutomationRuleAction,
    expected: "state:error:找不到這個漏斗或規則",
  },
  {
    name: "funnel automation: update tenant B's rule through tenant A's page",
    actor: owner(a),
    form: (f) => ruleForm(f.a.pageId, f.b.ruleId),
    run: updateFunnelAutomationRuleAction,
    expected: "state:error:找不到這個漏斗或規則",
  },
  {
    name: "funnel automation: update tenant B's rule through tenant B's page",
    actor: owner(a),
    form: (f) => ruleForm(f.b.pageId, f.b.ruleId),
    run: updateFunnelAutomationRuleAction,
    expected: "state:error:找不到這個漏斗或規則",
  },
  {
    name: "funnel automation: disable tenant B's rule through tenant A's page",
    actor: owner(a),
    form: (f) => formData({ pageId: f.a.pageId, ruleId: f.b.ruleId, version: "1", isActive: "false" }),
    run: setFunnelAutomationRuleEnabledAction,
    expected: "state:error:找不到這個漏斗或規則",
  },
  // 6. form-submission-search-actions (PII)
  {
    name: "form search: read tenant B's form submissions",
    actor: owner(a),
    form: (f) => formData({ formId: f.b.formId, query: "", verification: "ALL", source: "ALL", page: "1" }),
    run: (form) => searchFormSubmissionsAction({ status: "idle", message: "", result: null }, form),
    expected: "state:error:這張表單已不存在",
  },
];

const ownRows: Row[] = [
  {
    name: "vendor member: revoke own invitation",
    actor: owner(a),
    form: (f) => formData({ invitationId: f.a.invitationId }),
    run: revokeVendorMemberInvitationAction,
    expected: "updated=member_invitation_revoked",
    verify: async (f) => {
      expect((await db.vendorMemberInvitation.findUniqueOrThrow({ where: { id: f.a.invitationId } })).revokedAt).not.toBeNull();
    },
  },
  {
    name: "vendor member: resend to own member",
    actor: owner(a),
    form: (f) => formData({ id: f.a.actors.accountant.member.id }),
    run: resendVendorMemberInvitationAction,
    expected: "updated=member_invitation_resent",
    verify: async (f) => {
      expect(mocks.sendPasswordResetLink).toHaveBeenCalledTimes(1);
      expect(mocks.sendPasswordResetLink).toHaveBeenCalledWith(expect.objectContaining({ email: f.a.actors.accountant.user.email }));
    },
  },
  {
    name: "vendor member: downgrade own admin",
    actor: owner(a),
    form: (f) => formData({ id: f.a.actors.admin.member.id, role: "accountant" }),
    run: changeVendorMemberRoleAction,
    expected: "updated=member_role_downgraded",
    verify: async (f) => {
      expect((await db.vendorMember.findUniqueOrThrow({ where: { id: f.a.actors.admin.member.id } })).role).toBe("accountant");
    },
  },
  {
    name: "vendor member: deactivate own support member",
    actor: owner(a),
    form: (f) => formData({ id: f.a.actors.support.member.id, confirmation: f.a.actors.support.user.email }),
    run: deactivateVendorMemberAction,
    expected: "updated=member_deactivated",
    verify: async (f) => {
      expect((await db.vendorMember.findUniqueOrThrow({ where: { id: f.a.actors.support.member.id } })).status).toBe("inactive");
    },
  },
  {
    name: "team: add own member to own team",
    actor: owner(a),
    form: (f) => formData({ teamId: f.a.teamId, vendorMemberId: f.a.actors.admin.member.id }),
    run: addTeamMemberAction,
    expected: "updated=member_added",
    verify: async (f) => {
      expect(await db.teamMembership.count({ where: { vendorId: f.a.vendor.id, teamId: f.a.teamId, status: "ACTIVE" } })).toBe(3);
    },
  },
  {
    name: "team: transfer own membership to own second team",
    actor: owner(a),
    form: (f) => formData({ sourceTeamId: f.a.teamId, targetTeamId: f.extraTeamId, membershipId: f.a.supportTeamMembershipId }),
    run: transferTeamMemberAction,
    expected: "updated=member_transferred",
    verify: async (f) => {
      expect(await db.teamMembership.count({ where: { vendorId: f.a.vendor.id, teamId: f.extraTeamId, status: "ACTIVE" } })).toBe(1);
    },
  },
  {
    name: "team: set own upline",
    actor: owner(a),
    form: (f) => formData({ teamId: f.a.teamId, downlineMembershipId: f.a.supportTeamMembershipId, uplineMembershipId: f.a.ownerTeamMembershipId }),
    run: setTeamUplineAction,
    expected: "updated=relationship_saved",
    verify: async (f) => {
      expect(await db.teamMembershipRelationship.count({ where: { teamId: f.a.teamId, endedAt: null } })).toBe(1);
    },
  },
  {
    name: "team: deactivate own membership",
    actor: owner(a),
    form: (f) => formData({ teamId: f.a.teamId, membershipId: f.a.supportTeamMembershipId }),
    run: deactivateTeamMembershipAction,
    expected: "updated=member_deactivated",
    verify: async (f) => {
      expect((await db.teamMembership.findUniqueOrThrow({ where: { id: f.a.supportTeamMembershipId } })).status).toBe("INACTIVE");
    },
  },
  {
    name: "payout policy: owner of tenant A saves a new policy",
    actor: owner(a),
    form: () => formData({ expectedRevision: "0", bankFeeCents: "30", enabled: "on" }),
    run: saveMerchantAffiliatePayoutPolicyAction,
    expected: "saved=1",
    verify: async (f) => {
      expect(await db.merchantAffiliatePayoutPolicy.findUniqueOrThrow({ where: { vendorId: f.a.vendor.id } })).toMatchObject({ revision: 1, bankFeeCents: 30, enabled: true });
    },
  },
  {
    name: "payout outcome: void own pending payout",
    actor: (f) => f.a.actors.accountant,
    form: (f) => payoutForm(f.a.payoutId),
    run: recordAffiliatePayoutOutcomeAction,
    expected: "redirect:/affiliates/commissions",
    verify: async (f) => {
      expect(await db.affiliatePayout.findUniqueOrThrow({ where: { id: f.a.payoutId } })).toMatchObject({ status: "void", outcomeReason: "synthetic void" });
      expect((await db.affiliateCommission.findUniqueOrThrow({ where: { id: f.a.commissionId } })).status).toBe("void");
    },
  },
  {
    name: "funnel automation: list, create, update and disable on own page",
    actor: owner(a),
    form: (f) => ruleForm(f.a.pageId, f.a.ruleId),
    run: async (form) => {
      const pageId = String(form.get("pageId"));
      const ruleId = String(form.get("ruleId"));
      expect((await listFunnelAutomationRulesAction(formData({ pageId }))).rules).toHaveLength(1);
      expect((await createFunnelAutomationRuleAction(formData({ pageId, name: "第二條", tag: "t2" }))).status).toBe("success");
      const disabled = await setFunnelAutomationRuleEnabledAction(formData({ pageId, ruleId, version: "1", isActive: "false" }));
      expect(disabled.status).toBe("success");
      return updateFunnelAutomationRuleAction(ruleForm(pageId, ruleId, "2"));
    },
    expected: "state:success:規則已更新",
    verify: async (f) => {
      expect(await db.automationRule.findUniqueOrThrow({ where: { id: f.a.ruleId } })).toMatchObject({ name: "改名", isActive: false, version: 3 });
      expect(await db.automationRule.count({ where: { vendorId: f.a.vendor.id } })).toBe(2);
    },
  },
  {
    name: "form search: own form lists own submissions and never tenant B's",
    actor: owner(a),
    form: (f) => formData({ formId: f.a.formId, query: "example.test", verification: "ALL", source: "ALL", page: "1" }),
    run: async (form) => {
      const state = await searchFormSubmissionsAction({ status: "idle", message: "", result: null }, form);
      expect(state.result?.items.map((item) => item.email)).toEqual(["lead-a@example.test"]);
      expect(JSON.stringify(state)).not.toContain("lead-b@example.test");
      return state;
    },
    expected: "state:success:找到 1 筆報名資料",
  },
];

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.sendPasswordResetLink.mockResolvedValue(true);
  fixture = await createTwoTenantFixture(db);
  const extra = await db.salesTeam.create({ data: { vendorId: fixture.a.vendor.id, name: "Team A2", slug: `${fixture.a.projectId}-2` } });
  extraTeamId = extra.id;
  // A second team per tenant gives the transfer rows a target the tenant really owns.
  const extraB = await db.salesTeam.create({ data: { vendorId: fixture.b.vendor.id, name: "Team B2", slug: `${fixture.b.projectId}-2` } });
  extraTeamIdB = extraB.id;
  await db.merchantAffiliatePayoutPolicy.create({
    data: { vendorId: fixture.b.vendor.id, revision: 1, bankFeeCents: 15, enabled: true, updatedByUserId: fixture.b.actors.owner.user.id },
  });
});
afterEach(async () => {
  await fixture?.cleanup();
});
afterAll(async () => {
  await db.$disconnect();
});

function view(): Fix {
  return { a: fixture.a, b: fixture.b, extraTeamId, extraTeamIdB };
}

describe("second-tenant matrix: foreign identifiers are refused and nothing is written", () => {
  it.each(foreignRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    runtime.actor = row.actor(f);
    const [beforeA, beforeB] = [await snapshot(f.a.vendor.id), await snapshot(f.b.vendor.id)];

    const result = await outcome(() => row.run(row.form(f)));
    expect(result).toContain(row.expected);

    const [afterA, afterB] = [await snapshot(f.a.vendor.id), await snapshot(f.b.vendor.id)];
    // Tenant B is never touched. Tenant A is untouched too, except for the one
    // row that is deliberately a contained same-response invitation.
    expect(afterB).toBe(beforeB);
    if (row.expected !== "updated=member_invited") expect(afterA).toBe(beforeA);
    expect(mocks.sendPasswordResetLink).not.toHaveBeenCalled();
  });

  it("an invitation for tenant B's user address is recorded under tenant A only and creates no membership", async () => {
    const f = view();
    runtime.actor = f.a.actors.owner;
    const email = f.b.actors.support.user.email;
    expect(await outcome(() => createVendorMemberAction(formData({ email, name: "外部成員", role: "support" })))).toContain("updated=member_invited");
    expect(await db.vendorMemberInvitation.count({ where: { vendorId: f.a.vendor.id, email: email.toLowerCase() } })).toBe(1);
    expect(await db.vendorMemberInvitation.count({ where: { vendorId: f.b.vendor.id, email: email.toLowerCase() } })).toBe(0);
    expect(await db.vendorMember.count({ where: { vendorId: f.a.vendor.id, userId: f.b.actors.support.user.id } })).toBe(0);
  });
});

describe("second-tenant matrix: the same actions with own identifiers go through", () => {
  it.each(ownRows.map((row) => [row.name, row] as const))("%s", async (_name, row) => {
    const f = view();
    runtime.actor = row.actor(f);
    const beforeB = await snapshot(f.b.vendor.id);

    const result = await outcome(() => row.run(row.form(f)));
    expect(result).toContain(row.expected);
    await row.verify?.(f);

    // An own-tenant success never leaks into the other tenant.
    expect(await snapshot(f.b.vendor.id)).toBe(beforeB);
  });
});
