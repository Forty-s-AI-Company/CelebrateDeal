import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

// F-029 / B02-06 against PostgreSQL: inviting never creates a membership, the
// owner's response is identical for every kind of address, and only the
// invited account (or a new one for that address) can accept.
const state = vi.hoisted(() => ({ token: "", deferred: [] as Array<() => Promise<void> | void> }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "celebrate_session" && state.token ? { value: state.token } : undefined),
    set: (name: string, value: string) => { if (name === "celebrate_session") state.token = value; },
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void> | void) => { state.deferred.push(callback); },
}));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/app-url", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-url")>()),
  getCanonicalAppUrl: () => "https://app.example.test",
}));
vi.mock("@/lib/email", () => ({ sendVendorMemberInvitationEmail: vi.fn(async () => ({ id: "synthetic-email" })) }));

import { headers } from "next/headers";
import { changeVendorMemberRoleAction, createVendorMemberAction, deactivateVendorMemberAction, revokeVendorMemberInvitationAction } from "@/app/actions/vendor-member-actions";
import { loginAction } from "@/app/actions/auth-security-actions";
import { hashPassword } from "@/lib/password";
import { acceptVendorMemberInvitationAction } from "@/app/actions/vendor-member-invitation-actions";
import { sendVendorMemberInvitationEmail } from "@/lib/email";
import { merchantRegistrationPolicyVersions } from "@/lib/public-policy-content";
import {
  acceptVendorMemberInvitation,
  createVendorMemberInvitation,
  hashVendorMemberInvitationToken,
  revokeVendorMemberInvitation,
} from "@/lib/vendor-member-invitation";

const created = { vendorIds: [] as string[], userIds: [] as string[], emails: [] as string[] };

async function createUser(label: string, data: { platformRole?: string; status?: string } = {}) {
  const email = `${label}-${randomUUID()}@example.test`;
  const user = await getDb().user.create({ data: { name: label, email, passwordHash: "synthetic-only", ...data } });
  created.userIds.push(user.id);
  return user;
}

async function createVendor(label: string) {
  const suffix = randomUUID();
  const vendor = await getDb().vendor.create({
    data: { name: `Invite ${label}`, slug: `invite-${label}-${suffix}`, email: `invite-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  created.vendorIds.push(vendor.id);
  const owner = await createUser(`owner-${label}`);
  await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: "owner" } });
  // Owners pass the F-027 step-up with a fresh verification.
  await getDb().userMfaFactor.create({ data: { userId: owner.id, secretEncrypted: "synthetic-not-decrypted" } });
  return { vendor, owner };
}

async function signIn(userId: string, vendorId: string | null) {
  const token = randomBytes(32).toString("base64url");
  await getDb().userSession.create({
    data: {
      userId,
      vendorId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      mfaVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  state.token = token;
}

function inviteForm(email: string, role = "admin") {
  const form = new FormData();
  form.set("email", email);
  form.set("name", "Invited person");
  form.set("role", role);
  return form;
}

async function membership(vendorId: string, userId: string) {
  return getDb().vendorMember.findUnique({ where: { vendorId_userId: { vendorId, userId } } });
}

beforeEach(() => {
  state.token = "";
  state.deferred = [];
  vi.mocked(sendVendorMemberInvitationEmail).mockClear();
});

afterEach(async () => {
  const db = getDb();
  const vendorIds = created.vendorIds.splice(0);
  const userIds = created.userIds.splice(0);
  const emails = created.emails.splice(0);
  const newUsers = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  const allUserIds = [...userIds, ...newUsers.map((user) => user.id)];
  await db.auditLog.deleteMany({ where: { OR: [{ vendorId: { in: vendorIds } }, { actorId: { in: allUserIds } }] } });
  await db.vendorMemberInvitation.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.userPolicyConsent.deleteMany({ where: { userId: { in: allUserIds } } });
  await db.userSession.deleteMany({ where: { userId: { in: allUserIds } } });
  await db.vendorMember.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await db.user.deleteMany({ where: { id: { in: allUserIds } } });
});

describe("member invitation request (PostgreSQL)", () => {
  it("answers identically for unknown, other-tenant, platform-admin and suspended addresses without creating memberships", async () => {
    const { vendor, owner } = await createVendor("a");
    const other = await createVendor("b");
    const foreignUser = await createUser("foreign");
    await getDb().vendorMember.create({ data: { vendorId: other.vendor.id, userId: foreignUser.id, role: "owner" } });
    const platformAdmin = await createUser("platform", { platformRole: "platform_admin" });
    const suspended = await createUser("suspended", { status: "inactive" });
    const unknown = `unknown-${randomUUID()}@example.test`;
    created.emails.push(unknown);
    await signIn(owner.id, vendor.id);

    const outcomes: string[] = [];
    for (const email of [unknown, foreignUser.email, platformAdmin.email, suspended.email]) {
      const error = await createVendorMemberAction(inviteForm(email)).catch((caught: Error) => caught.message);
      outcomes.push(String(error));
    }

    expect(new Set(outcomes)).toEqual(new Set(["redirect:/settings/security?updated=member_invited"]));
    expect(await getDb().vendorMember.count({ where: { vendorId: vendor.id } })).toBe(1);
    expect(await membership(vendor.id, foreignUser.id)).toBeNull();
    expect(await getDb().vendorMemberInvitation.count({ where: { vendorId: vendor.id, acceptedAt: null, revokedAt: null } })).toBe(4);

    for (const work of state.deferred) await work();
    const recipients = vi.mocked(sendVendorMemberInvitationEmail).mock.calls.map(([input]) => input.to).sort();
    expect(recipients).toEqual([unknown, foreignUser.email].sort());
    // The tenant-visible audit trail is the same for every branch.
    const vendorAudit = await getDb().auditLog.findMany({ where: { vendorId: vendor.id }, select: { action: true } });
    expect(vendorAudit.map((entry) => entry.action)).toEqual(Array(4).fill("invite_vendor_member"));
  });

  it("revokes an earlier pending link for the same address and only within the session vendor", async () => {
    const { vendor, owner } = await createVendor("reissue");
    const other = await createVendor("other");
    const first = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: "Person@Example.test", name: "P", role: "support" });
    const second = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: "person@example.test", name: "P", role: "support" });

    const rows = await getDb().vendorMemberInvitation.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.email, Boolean(row.revokedAt)])).toEqual([["person@example.test", true], ["person@example.test", false]]);
    expect(rows.every((row) => row.tokenHash !== first.token && row.tokenHash !== second.token)).toBe(true);

    expect(await revokeVendorMemberInvitation(getDb(), { vendorId: other.vendor.id, invitationId: second.invitationId })).toBe(false);
    await signIn(other.owner.id, other.vendor.id);
    const form = new FormData();
    form.set("invitationId", second.invitationId);
    await expect(revokeVendorMemberInvitationAction(form)).rejects.toThrow("error=member_invitation_not_found");
    expect((await getDb().vendorMemberInvitation.findUniqueOrThrow({ where: { id: second.invitationId } })).revokedAt).toBeNull();
  });
});

describe("deactivate, invite again and reactivate (#462 M1, PostgreSQL)", () => {
  it("lets a deactivated member sign in only to accept the new invitation and become active again", async () => {
    const { vendor, owner } = await createVendor("reactivate");
    const password = "synthetic-member-password-123";
    const member = await getDb().user.create({
      data: { name: "Returning member", email: `returning-${randomUUID()}@example.test`, passwordHash: hashPassword(password) },
    });
    created.userIds.push(member.id);
    const membershipRow = await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: member.id, role: "accountant" } });

    await signIn(owner.id, vendor.id);
    const deactivate = new FormData();
    deactivate.set("id", membershipRow.id);
    deactivate.set("confirmation", member.email);
    await expect(deactivateVendorMemberAction(deactivate)).rejects.toThrow("updated=member_deactivated");
    expect(await membership(vendor.id, member.id)).toMatchObject({ status: "inactive" });

    const login = (next?: string) => {
      const form = new FormData();
      form.set("email", member.email);
      form.set("password", password);
      if (next) form.set("next", next);
      return form;
    };
    // Without a pending invitation the account still has no workspace.
    state.token = "";
    await expect(loginAction(login())).rejects.toThrow("redirect:/login?error=no_vendor");
    expect(state.token).toBe("");

    await signIn(owner.id, vendor.id);
    await expect(createVendorMemberAction(inviteForm(member.email, "support"))).rejects.toThrow("updated=member_invited");
    for (const work of state.deferred) await work();
    const acceptUrl = new URL(vi.mocked(sendVendorMemberInvitationEmail).mock.calls[0]![0].acceptUrl);
    const acceptPath = `${acceptUrl.pathname}${acceptUrl.search}`;
    expect(await membership(vendor.id, member.id)).toMatchObject({ status: "inactive" });

    state.token = "";
    await expect(loginAction(login(acceptPath))).rejects.toThrow(`redirect:${acceptPath}`);
    expect(state.token).not.toBe("");
    const session = await getDb().userSession.findFirstOrThrow({ where: { userId: member.id, revokedAt: null } });
    expect(session.vendorId).toBeNull();

    const accept = new FormData();
    accept.set("token", acceptUrl.searchParams.get("token")!);
    await expect(acceptVendorMemberInvitationAction(accept)).rejects.toThrow("redirect:/dashboard");
    expect(await membership(vendor.id, member.id)).toMatchObject({ status: "active", role: "support", deactivatedAt: null });
  });
});

describe("owner role downgrade (#462 m7, PostgreSQL)", () => {
  function roleForm(id: string, role: string) {
    const form = new FormData();
    form.set("id", id);
    form.set("role", role);
    return form;
  }

  it("lowers a role at once but never raises one, changes the owner, or reaches another tenant", async () => {
    const { vendor, owner } = await createVendor("downgrade");
    const other = await createVendor("downgrade-other");
    const admin = await createUser("admin");
    const adminMember = await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: admin.id, role: "admin" } });
    const support = await createUser("support");
    const supportMember = await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: support.id, role: "support" } });
    const coOwner = await createUser("co-owner");
    const coOwnerMember = await getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: coOwner.id, role: "owner" } });
    const foreign = await createUser("foreign-admin");
    const foreignMember = await getDb().vendorMember.create({ data: { vendorId: other.vendor.id, userId: foreign.id, role: "admin" } });
    const ownMembership = await getDb().vendorMember.findFirstOrThrow({ where: { vendorId: vendor.id, userId: owner.id } });
    await signIn(owner.id, vendor.id);

    await expect(changeVendorMemberRoleAction(roleForm(adminMember.id, "support"))).rejects.toThrow("updated=member_role_downgraded");
    expect(await membership(vendor.id, admin.id)).toMatchObject({ role: "support", status: "active" });

    await expect(changeVendorMemberRoleAction(roleForm(supportMember.id, "admin"))).rejects.toThrow("error=member_role_upgrade");
    await expect(changeVendorMemberRoleAction(roleForm(supportMember.id, "accountant"))).rejects.toThrow("error=member_role_upgrade");
    expect(await membership(vendor.id, support.id)).toMatchObject({ role: "support" });

    await expect(changeVendorMemberRoleAction(roleForm(ownMembership.id, "admin"))).rejects.toThrow("error=self_role");
    await expect(changeVendorMemberRoleAction(roleForm(foreignMember.id, "support"))).rejects.toThrow("error=member_not_found");
    expect(await membership(other.vendor.id, foreign.id)).toMatchObject({ role: "admin" });

    // Another owner may be demoted while the acting owner remains.
    await expect(changeVendorMemberRoleAction(roleForm(coOwnerMember.id, "admin"))).rejects.toThrow("updated=member_role_downgraded");
    expect(await getDb().auditLog.count({ where: { vendorId: vendor.id, action: "downgrade_vendor_member_role" } })).toBe(2);
  });
});

describe("member invitation acceptance (PostgreSQL)", () => {
  it("requires the invited account itself to sign in and accept", async () => {
    const { vendor, owner } = await createVendor("accept");
    const invitee = await createUser("invitee");
    const stranger = await createUser("stranger");
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: invitee.email, name: "Invitee", role: "accountant" });

    expect(await acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: null })).toEqual({ ok: false, reason: "login_required" });
    expect(await acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: stranger.id })).toEqual({ ok: false, reason: "wrong_account" });
    expect(await membership(vendor.id, invitee.id)).toBeNull();

    await signIn(invitee.id, null);
    const form = new FormData();
    form.set("token", invitation.token);
    await expect(acceptVendorMemberInvitationAction(form)).rejects.toThrow("redirect:/dashboard");

    expect(await membership(vendor.id, invitee.id)).toMatchObject({ role: "accountant", status: "active" });
    const stored = await getDb().vendorMemberInvitation.findUniqueOrThrow({ where: { id: invitation.invitationId } });
    expect(stored.acceptedUserId).toBe(invitee.id);
    // Single use.
    expect(await acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: invitee.id })).toEqual({ ok: false, reason: "invalid" });
  });

  it("creates a new account with consent only for an address without one", async () => {
    const { vendor, owner } = await createVendor("new");
    const email = `fresh-${randomUUID()}@example.test`;
    created.emails.push(email);
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email, name: "Fresh", role: "support" });
    const policy = merchantRegistrationPolicyVersions();
    const form = new FormData();
    form.set("token", invitation.token);
    form.set("name", "Fresh Member");
    form.set("password", "synthetic-password-123");
    form.set("confirmPassword", "synthetic-password-123");
    form.set("acceptPolicies", "on");
    form.set("policyVersion", policy.consentVersion);

    await expect(acceptVendorMemberInvitationAction(form)).rejects.toThrow("redirect:/login?invited=1");

    const user = await getDb().user.findUniqueOrThrow({ where: { email }, include: { policyConsents: true } });
    expect(user.passwordHash).not.toContain("synthetic-password-123");
    expect(user.policyConsents).toEqual([expect.objectContaining({ vendorId: vendor.id, context: "vendor_member_invitation" })]);
    expect(await membership(vendor.id, user.id)).toMatchObject({ role: "support", status: "active" });
  });

  it("refuses a short, long, common or self-referencing password without creating the account", async () => {
    const { vendor, owner } = await createVendor("policy");
    const name = `policy${randomUUID().slice(0, 8)}`;
    const email = `${name}@example.test`;
    created.emails.push(email);
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email, name: "Policy", role: "support" });
    const policy = merchantRegistrationPolicyVersions();

    const attempts = [["bluewha", "short"], ["x".repeat(129), "long"], ["Password123", "common"], ["dragon2026", "common"], [`${name}!2026`, "personal"]] as const;
    for (const [index, [password, reason]] of attempts.entries()) {
      // A distinct synthetic source per attempt, so this case never spends the shared acceptance rate-limit budget.
      vi.mocked(headers).mockResolvedValueOnce(new Headers({ "user-agent": "synthetic-agent", "x-forwarded-for": `198.51.100.${index + 10}` }) as Awaited<ReturnType<typeof headers>>);
      const form = new FormData();
      form.set("token", invitation.token);
      form.set("name", "Policy Member");
      form.set("password", password);
      form.set("confirmPassword", password);
      form.set("acceptPolicies", "on");
      form.set("policyVersion", policy.consentVersion);
      await expect(acceptVendorMemberInvitationAction(form)).rejects.toThrow(`&error=${reason}`);
    }

    expect(await getDb().user.findUnique({ where: { email } })).toBeNull();
    const stored = await getDb().vendorMemberInvitation.findUniqueOrThrow({ where: { id: invitation.invitationId } });
    expect(stored.acceptedAt).toBeNull();
  });

  it.each([
    ["platform administrator", { platformRole: "platform_admin" }],
    ["suspended account", { status: "inactive" }],
  ])("never lets a %s accept, even when signed in", async (_label, data) => {
    const { vendor, owner } = await createVendor("blocked");
    const user = await createUser("blocked", data);
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: user.email, name: "Blocked", role: "owner" });

    expect(invitation.deliver).toBe(false);
    expect(await acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: user.id })).toEqual({ ok: false, reason: "invalid" });
    expect(await membership(vendor.id, user.id)).toBeNull();
  });

  it("rejects expired, revoked and forged tokens", async () => {
    const { vendor, owner } = await createVendor("expired");
    const invitee = await createUser("expired-invitee");
    const expired = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: invitee.email, name: "E", role: "admin", now: new Date(Date.now() - 73 * 60 * 60_000) });
    expect(await acceptVendorMemberInvitation(getDb(), { token: expired.token, actorUserId: invitee.id })).toEqual({ ok: false, reason: "invalid" });

    const revoked = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: invitee.email, name: "E", role: "admin" });
    await revokeVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitationId: revoked.invitationId });
    expect(await acceptVendorMemberInvitation(getDb(), { token: revoked.token, actorUserId: invitee.id })).toEqual({ ok: false, reason: "invalid" });

    expect(await acceptVendorMemberInvitation(getDb(), { token: hashVendorMemberInvitationToken(revoked.token), actorUserId: invitee.id })).toEqual({ ok: false, reason: "invalid" });
    expect(await membership(vendor.id, invitee.id)).toBeNull();
  });

  it("keeps at least one active owner when an accepted role would demote the last owner", async () => {
    const { vendor, owner } = await createVendor("last-owner");
    const inviter = await createUser("inviter");
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: inviter.id, email: owner.email, name: "Owner", role: "admin" });

    expect(await acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: owner.id })).toEqual({ ok: false, reason: "last_owner" });
    expect(await membership(vendor.id, owner.id)).toMatchObject({ role: "owner", status: "active" });
  });

  it("consumes a token once under concurrent acceptance", async () => {
    const { vendor, owner } = await createVendor("race");
    const invitee = await createUser("race-invitee");
    const invitation = await createVendorMemberInvitation(getDb(), { vendorId: vendor.id, invitedByUserId: owner.id, email: invitee.email, name: "R", role: "support" });

    const results = await Promise.all(Array.from({ length: 4 }, () => acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: invitee.id })));

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    // Losers see "invalid" (token used) or a retryable serialization conflict, never a second success.
    for (const result of results.filter((item) => !item.ok)) expect(["invalid", "retry"]).toContain((result as { reason: string }).reason);
    expect(await getDb().auditLog.count({ where: { vendorId: vendor.id, action: "accept_vendor_member_invitation" } })).toBe(1);
    // Retrying after the winner reports the token as used.
    await expect(acceptVendorMemberInvitation(getDb(), { token: invitation.token, actorUserId: invitee.id })).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("enforces the stored invariants in the database", async () => {
    const { vendor } = await createVendor("check");
    const base = { vendorId: vendor.id, name: "X", tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000) };
    await expect(getDb().vendorMemberInvitation.create({ data: { ...base, email: "x@example.test", role: "platform_admin" } })).rejects.toThrow();
    await expect(getDb().vendorMemberInvitation.create({ data: { ...base, email: "Upper@Example.test", role: "admin" } })).rejects.toThrow();
    await expect(getDb().vendorMemberInvitation.create({ data: { ...base, email: "x@example.test", role: "admin", tokenHash: "raw-token" } })).rejects.toThrow();
    await expect(getDb().vendorMemberInvitation.create({ data: { ...base, email: "x@example.test", role: "admin", acceptedAt: new Date(), revokedAt: new Date() } })).rejects.toThrow();
  });
});
