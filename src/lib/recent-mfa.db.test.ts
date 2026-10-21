import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";

// F-027 (B02-04): exercise the real session lookup in @/lib/auth together
// with the step-up guard, so the 15-minute window is read from the stored
// `UserSession.mfaVerifiedAt`, not from a hand-built actor.
const cookieJar = vi.hoisted(() => ({ token: "" }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "celebrate_session" && cookieJar.token ? { value: cookieJar.token } : undefined),
    set: vi.fn(),
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
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined) }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));

import { markCurrentSessionMfaVerified } from "@/lib/auth";
import { deactivateVendorMemberAction } from "@/app/actions/vendor-member-actions";
import { GET as exportElectronicInvoices } from "@/app/(app)/billing/electronic-invoices/export/route";

type Tenant = { vendorId: string; ownerId: string; memberId: string; memberEmail: string; userIds: string[] };
const tenants: Tenant[] = [];

async function createTenant(label: string, options: { ownerHasFactor: boolean }): Promise<Tenant> {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: `Step-up ${label}`, slug: `step-up-${label}-${suffix}`, email: `step-up-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  const owner = await db.user.create({ data: { name: `Owner ${label}`, email: `owner-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  const memberEmail = `member-${suffix}@example.test`;
  const memberUser = await db.user.create({ data: { name: `Member ${label}`, email: memberEmail, passwordHash: "synthetic-only" } });
  await db.vendorMember.create({ data: { vendorId: vendor.id, userId: owner.id, role: "owner" } });
  const member = await db.vendorMember.create({ data: { vendorId: vendor.id, userId: memberUser.id, role: "accountant" } });
  if (options.ownerHasFactor) {
    await db.userMfaFactor.create({ data: { userId: owner.id, secretEncrypted: "synthetic-not-decrypted" } });
  }
  const tenant = { vendorId: vendor.id, ownerId: owner.id, memberId: member.id, memberEmail, userIds: [owner.id, memberUser.id] };
  tenants.push(tenant);
  return tenant;
}

async function signIn(tenant: Tenant, mfaVerifiedAt: Date | null) {
  const token = randomBytes(32).toString("base64url");
  await getDb().userSession.create({
    data: {
      userId: tenant.ownerId,
      vendorId: tenant.vendorId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      mfaVerifiedAt,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  cookieJar.token = token;
}

function deactivateForm(tenant: Tenant) {
  const form = new FormData();
  form.set("id", tenant.memberId);
  form.set("confirmation", tenant.memberEmail);
  return form;
}

async function memberStatus(tenant: Tenant) {
  return (await getDb().vendorMember.findUniqueOrThrow({ where: { id: tenant.memberId } })).status;
}

beforeEach(() => {
  cookieJar.token = "";
});

afterEach(async () => {
  const db = getDb();
  for (const tenant of tenants.splice(0)) {
    await db.auditLog.deleteMany({ where: { vendorId: tenant.vendorId } });
    await db.userSession.deleteMany({ where: { userId: { in: tenant.userIds } } });
    await db.vendorMember.deleteMany({ where: { vendorId: tenant.vendorId } });
    await db.user.deleteMany({ where: { id: { in: tenant.userIds } } });
    await db.vendor.deleteMany({ where: { id: tenant.vendorId } });
  }
});

describe("high-risk step-up with real sessions (PostgreSQL)", () => {
  it("sends an owner without a factor to /mfa/setup and leaves the member untouched", async () => {
    const tenant = await createTenant("no-factor", { ownerHasFactor: false });
    // A password-only session is a valid login during the closed beta.
    await signIn(tenant, null);

    await expect(deactivateVendorMemberAction(deactivateForm(tenant))).rejects.toThrow(
      "redirect:/mfa/setup?reason=step_up&next=%2Fsettings%2Fsecurity",
    );
    expect(await memberStatus(tenant)).toBe("active");
    expect(await getDb().auditLog.count({ where: { vendorId: tenant.vendorId } })).toBe(0);
  });

  it("requires re-verification when the stored verification is older than 15 minutes", async () => {
    const tenant = await createTenant("stale", { ownerHasFactor: true });
    await signIn(tenant, new Date(Date.now() - 16 * 60_000));

    await expect(deactivateVendorMemberAction(deactivateForm(tenant))).rejects.toThrow(
      "redirect:/mfa/verify?reason=step_up&next=%2Fsettings%2Fsecurity",
    );
    expect(await memberStatus(tenant)).toBe("active");
  });

  it("allows the operation after /mfa/verify refreshes the session stamp", async () => {
    const tenant = await createTenant("refresh", { ownerHasFactor: true });
    await signIn(tenant, new Date(Date.now() - 60 * 60_000));
    await expect(deactivateVendorMemberAction(deactivateForm(tenant))).rejects.toThrow("redirect:/mfa/verify");

    // verifyMfaAction stamps the current session through this helper.
    await markCurrentSessionMfaVerified();

    await expect(deactivateVendorMemberAction(deactivateForm(tenant))).rejects.toThrow(
      "redirect:/settings/security?updated=member_deactivated",
    );
    expect(await memberStatus(tenant)).toBe("inactive");
  });

  it("does not let a fresh verification in one tenant reach another tenant's member", async () => {
    const own = await createTenant("own", { ownerHasFactor: true });
    const foreign = await createTenant("foreign", { ownerHasFactor: true });
    await signIn(own, new Date());

    await expect(deactivateVendorMemberAction(deactivateForm(foreign))).rejects.toThrow(
      "redirect:/settings/security?error=member_not_found",
    );
    expect(await memberStatus(foreign)).toBe("active");
  });

  it("blocks a personal-data export for a stale session before reading any invoice", async () => {
    const tenant = await createTenant("export", { ownerHasFactor: true });
    await signIn(tenant, new Date(Date.now() - 20 * 60_000));

    await expect(exportElectronicInvoices()).rejects.toThrow(
      "redirect:/mfa/verify?reason=step_up&next=%2Fbilling%2Felectronic-invoices",
    );

    await getDb().userSession.updateMany({ where: { userId: tenant.ownerId }, data: { mfaVerifiedAt: new Date() } });
    const response = await exportElectronicInvoices();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
