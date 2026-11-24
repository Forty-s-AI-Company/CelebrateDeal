import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// O-11 封測合作協議 clickwrap on real PostgreSQL. Only the request boundary
// (cookies, navigation, CSRF) is synthetic; the guards, the Server Action and
// every query run for real.
const cookieJar = vi.hoisted(() => ({ token: "" }));
const agreement = vi.hoisted(() => ({ version: "" }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name.endsWith("celebrate_session") && cookieJar.token ? { value: cookieJar.token } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
  headers: vi.fn(async () => new Headers({ "user-agent": "synthetic-agent" })),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string): never => { throw new Error(`redirect:${url}`); },
  notFound: (): never => { throw new Error("not_found"); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// verifyCsrfToken fails so the API check below stops right after the agreement check.
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: vi.fn(async () => undefined), verifyCsrfToken: vi.fn(async () => false) }));
// A later agreement version is simulated by swapping the server's current version.
vi.mock("@/lib/beta-agreement-content", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/beta-agreement-content")>();
  agreement.version = actual.BETA_AGREEMENT_VERSION;
  return {
    ...actual,
    get BETA_AGREEMENT_VERSION() { return agreement.version; },
  };
});

import { acceptBetaAgreementAction, switchFromBetaAgreementGateAction } from "@/app/actions/beta-agreement-actions";
import { requireVendorContext, requireVendorOwner } from "@/lib/auth";
import { BETA_AGREEMENT_CONTEXT, betaAgreementTextSha256, recordBetaAgreementAcceptance, vendorHasAcceptedBetaAgreement } from "@/lib/beta-agreement";
import { getDb } from "@/lib/db";
import { requireMerchantApiActor } from "@/lib/merchant-api-security";

const db = getDb();
const ORIGINAL_VERSION = "beta-2026.11.24";
const vendorIds: string[] = [];
const userIds: string[] = [];

beforeAll(() => {
  vi.stubEnv("CSRF_SECRET", "ci-csrf-fixture-32-bytes-safe-key");
});

afterEach(async () => {
  cookieJar.token = "";
  agreement.version = ORIGINAL_VERSION;
  await db.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

async function createUser(label: string) {
  const user = await db.user.create({ data: { name: label, email: `beta-${label.toLowerCase()}-${randomUUID()}@example.test`, passwordHash: "synthetic-only" } });
  userIds.push(user.id);
  return user;
}

async function createVendor(label: string) {
  const key = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Beta ${label}`, slug: `beta-${label.toLowerCase()}-${key}`, email: `vendor-${key}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  return vendor;
}

async function addMember(vendorId: string, userId: string, role: string) {
  await db.vendorMember.create({ data: { vendorId, userId, role, status: "active" } });
}

async function signIn(userId: string, vendorId: string | null) {
  const token = randomBytes(32).toString("base64url");
  await db.userSession.create({
    data: { userId, vendorId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  cookieJar.token = token;
}

async function outcome(run: () => Promise<unknown>) {
  try {
    await run();
    return "completed";
  } catch (error) {
    return (error as Error).message;
  }
}

function acceptForm(vendorId: string, values: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ vendorId, agreementVersion: agreement.version, acceptBetaAgreement: "on", ...values })) form.set(key, value);
  return form;
}

function merchantApiRequest() {
  return new Request("http://127.0.0.1:3000/api/synthetic", { method: "POST", headers: { origin: "http://127.0.0.1:3000", "x-celebratedeal-client": "web" } });
}

describe("封測合作協議 gate and consent record", () => {
  it("holds the owner until acceptance, records it once with an audit, then lets the owner in", async () => {
    const vendor = await createVendor("A");
    const owner = await createUser("Owner");
    await addMember(vendor.id, owner.id, "owner");
    await signIn(owner.id, vendor.id);

    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/beta-agreement");
    await expect(outcome(() => requireVendorContext("/welcome"))).resolves.toBe("redirect:/beta-agreement?next=%2Fwelcome");
    await expect(outcome(() => requireVendorOwner())).resolves.toBe("redirect:/beta-agreement");

    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id, { next: "/welcome" })))).resolves.toBe("redirect:/welcome");
    const rows = await db.userPolicyConsent.findMany({ where: { vendorId: vendor.id } });
    expect(rows).toEqual([expect.objectContaining({
      userId: owner.id, vendorId: vendor.id, context: BETA_AGREEMENT_CONTEXT, agreementVersion: ORIGINAL_VERSION,
      termsVersion: null, privacyVersion: null, acceptedAt: expect.any(Date),
    })]);
    const audits = await db.auditLog.findMany({ where: { vendorId: vendor.id, action: "beta_agreement_accepted" } });
    expect(audits).toEqual([expect.objectContaining({ actorId: owner.id, targetType: "Vendor", targetId: vendor.id, after: { agreementVersion: ORIGINAL_VERSION, agreementSha256: betaAgreementTextSha256(), vendorName: "Beta A" } })]);

    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");
    await expect(outcome(() => requireVendorOwner())).resolves.toBe("completed");

    // Idempotent: a second submission (a double click, a back button) adds nothing.
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id)))).resolves.toBe("redirect:/dashboard");
    expect(await db.userPolicyConsent.count({ where: { vendorId: vendor.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { vendorId: vendor.id, action: "beta_agreement_accepted" } })).toBe(1);
  });

  it("collapses concurrent acceptances by the same owner into one row and one audit", async () => {
    const vendor = await createVendor("Race");
    const owner = await createUser("RaceOwner");
    await addMember(vendor.id, owner.id, "owner");
    const results = await Promise.all(Array.from({ length: 4 }, () => recordBetaAgreementAcceptance(db, { userId: owner.id, vendorId: vendor.id, vendorName: vendor.name })));
    expect(results.filter((result) => result === "recorded")).toHaveLength(1);
    expect(results.filter((result) => result === "already_recorded")).toHaveLength(3);
    expect(await db.userPolicyConsent.count({ where: { vendorId: vendor.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { vendorId: vendor.id, action: "beta_agreement_accepted" } })).toBe(1);
  });

  it("never lets vendor A's acceptance open vendor B, even for an owner of both", async () => {
    const a = await createVendor("TenantA");
    const b = await createVendor("TenantB");
    const owner = await createUser("BothOwner");
    const ownerB = await createUser("OwnerB");
    await addMember(a.id, owner.id, "owner");
    await addMember(b.id, owner.id, "owner");
    await addMember(b.id, ownerB.id, "owner");

    await signIn(owner.id, a.id);
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(a.id)))).resolves.toBe("redirect:/dashboard");
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");

    await signIn(owner.id, b.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/beta-agreement");
    await signIn(ownerB.id, b.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/beta-agreement");
    expect(await vendorHasAcceptedBetaAgreement(db, b.id)).toBe(false);

    // A form naming vendor A while the session is on B is refused, and nothing is written for either.
    await signIn(owner.id, b.id);
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(a.id)))).resolves.toBe("redirect:/beta-agreement?error=vendor_changed");
    expect(await db.userPolicyConsent.count({ where: { vendorId: b.id } })).toBe(0);
    expect(await db.userPolicyConsent.count({ where: { vendorId: a.id } })).toBe(1);

    // The same user accepting for B is a separate row (one per user, vendor and version).
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(b.id)))).resolves.toBe("redirect:/dashboard");
    expect(await db.userPolicyConsent.count({ where: { userId: owner.id, context: BETA_AGREEMENT_CONTEXT } })).toBe(2);
    await signIn(ownerB.id, b.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");
  });

  it("asks every vendor again after the agreement version changes", async () => {
    const vendor = await createVendor("Upgrade");
    const owner = await createUser("UpgradeOwner");
    await addMember(vendor.id, owner.id, "owner");
    await signIn(owner.id, vendor.id);
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id)))).resolves.toBe("redirect:/dashboard");
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");

    agreement.version = "beta-2027.01.01";
    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/beta-agreement");
    // A page still showing the old version cannot record consent to the new one.
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id, { agreementVersion: ORIGINAL_VERSION })))).resolves.toBe("redirect:/beta-agreement?error=agreement_updated");
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id)))).resolves.toBe("redirect:/dashboard");
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");
    const versions = (await db.userPolicyConsent.findMany({ where: { vendorId: vendor.id }, orderBy: { acceptedAt: "asc" } })).map((row) => row.agreementVersion);
    expect(versions).toEqual([ORIGINAL_VERSION, "beta-2027.01.01"]);
  });

  it.each(["admin", "accountant", "support"])("holds a %s member until an owner accepts, and refuses the member's own acceptance", async (role) => {
    const vendor = await createVendor(`Role${role}`);
    const owner = await createUser(`Owner${role}`);
    const member = await createUser(`Member${role}`);
    await addMember(vendor.id, owner.id, "owner");
    await addMember(vendor.id, member.id, role);

    await signIn(member.id, vendor.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/beta-agreement");
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id)))).resolves.toBe("redirect:/beta-agreement?error=owner_required");
    // Even a direct call to the writer re-checks the owner role inside its transaction.
    await expect(recordBetaAgreementAcceptance(db, { userId: member.id, vendorId: vendor.id, vendorName: vendor.name })).resolves.toBe("not_owner");
    expect(await db.userPolicyConsent.count({ where: { vendorId: vendor.id } })).toBe(0);

    await signIn(owner.id, vendor.id);
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id)))).resolves.toBe("redirect:/dashboard");
    await signIn(member.id, vendor.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");
  });

  it("refuses merchant APIs until the vendor accepts", async () => {
    const vendor = await createVendor("Api");
    const owner = await createUser("ApiOwner");
    await addMember(vendor.id, owner.id, "owner");
    await signIn(owner.id, vendor.id);

    const held = await requireMerchantApiActor(merchantApiRequest());
    expect(held.response?.status).toBe(403);
    await expect(held.response?.json()).resolves.toEqual({ error: { code: "BETA_AGREEMENT_REQUIRED" } });

    await recordBetaAgreementAcceptance(db, { userId: owner.id, vendorId: vendor.id, vendorName: vendor.name });
    const allowed = await requireMerchantApiActor(merchantApiRequest());
    // Past the agreement check; the request then stops at the CSRF header it does not carry.
    await expect(allowed.response?.json()).resolves.toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("lets a held member switch the session to another of their vendors (review m-2)", async () => {
    const held = await createVendor("Held");
    const other = await createVendor("Other");
    const stranger = await createVendor("Stranger");
    const owner = await createUser("HeldOwner");
    const member = await createUser("HeldMember");
    await addMember(held.id, owner.id, "owner");
    await addMember(held.id, member.id, "admin");
    await addMember(other.id, member.id, "owner");
    await recordBetaAgreementAcceptance(db, { userId: member.id, vendorId: other.id, vendorName: other.name });
    await signIn(member.id, held.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/beta-agreement");

    const switchForm = (vendorId: string) => { const form = new FormData(); form.set("vendorId", vendorId); return form; };
    // Not a member of the stranger vendor: nothing changes.
    await expect(outcome(() => switchFromBetaAgreementGateAction(switchForm(stranger.id)))).resolves.toBe("redirect:/beta-agreement");
    await expect(outcome(() => switchFromBetaAgreementGateAction(switchForm(other.id)))).resolves.toBe("redirect:/dashboard");
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");
    const audit = await db.auditLog.findFirstOrThrow({ where: { vendorId: other.id, action: "session_vendor_switched", actorId: member.id } });
    // The held vendor is not named in the other tenant's audit trail.
    expect(audit.before).toEqual({ from: "beta_agreement_pending" });
    expect(JSON.stringify(audit)).not.toContain(held.id);
    // Once the session's vendor is not held, this is not a general vendor switcher.
    await expect(outcome(() => switchFromBetaAgreementGateAction(switchForm(held.id)))).resolves.toBe("redirect:/dashboard");
    expect(await db.auditLog.count({ where: { action: "session_vendor_switched", actorId: member.id } })).toBe(1);
  });

  it("records the acceptance of a platform administrator who owns the vendor (review m-3)", async () => {
    const vendor = await createVendor("AdminOwned");
    const admin = await db.user.create({ data: { name: "Platform owner", email: `beta-admin-owner-${randomUUID()}@example.test`, passwordHash: "synthetic-only", platformRole: "platform_admin" } });
    userIds.push(admin.id);
    const staff = await createUser("AdminOwnedStaff");
    await addMember(vendor.id, admin.id, "owner");
    await addMember(vendor.id, staff.id, "support");
    await signIn(staff.id, vendor.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("redirect:/beta-agreement");

    await signIn(admin.id, vendor.id);
    await expect(outcome(() => acceptBetaAgreementAction(acceptForm(vendor.id)))).resolves.toBe("redirect:/dashboard");
    expect(await db.userPolicyConsent.count({ where: { vendorId: vendor.id, userId: admin.id, context: BETA_AGREEMENT_CONTEXT } })).toBe(1);
    await signIn(staff.id, vendor.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");
  });

  it("does not gate a platform administrator", async () => {
    const vendor = await createVendor("Platform");
    const admin = await db.user.create({ data: { name: "Platform admin", email: `beta-admin-${randomUUID()}@example.test`, passwordHash: "synthetic-only", platformRole: "platform_admin" } });
    userIds.push(admin.id);
    await addMember(vendor.id, admin.id, "owner");
    await signIn(admin.id, vendor.id);
    await expect(outcome(() => requireVendorContext())).resolves.toBe("completed");
    expect(await db.userPolicyConsent.count({ where: { vendorId: vendor.id } })).toBe(0);
  });
});

describe("UserPolicyConsent shape (migration 20261120100000)", () => {
  async function insertRaw(values: { userId: string; vendorId: string | null; context: string; termsVersion: string | null; privacyVersion: string | null; agreementVersion: string | null }) {
    return db.$executeRaw(Prisma.sql`
      INSERT INTO "UserPolicyConsent" ("id", "userId", "vendorId", "context", "termsVersion", "privacyVersion", "agreementVersion")
      VALUES (${randomUUID()}, ${values.userId}, ${values.vendorId}, ${values.context}, ${values.termsVersion}, ${values.privacyVersion}, ${values.agreementVersion})`);
  }

  it("allows exactly one shape per context", async () => {
    const vendor = await createVendor("Shape");
    const user = await createUser("ShapeUser");
    const base = { userId: user.id, vendorId: vendor.id };
    await expect(insertRaw({ ...base, context: "beta_agreement", termsVersion: null, privacyVersion: null, agreementVersion: "beta-2026.11.20" })).resolves.toBe(1);
    await expect(insertRaw({ ...base, context: "merchant_registration", termsVersion: "2026.10.18", privacyVersion: "2026.10.18", agreementVersion: null })).resolves.toBe(1);

    const rejected = [
      { context: "beta_agreement", termsVersion: null, privacyVersion: null, agreementVersion: null },
      { context: "beta_agreement", termsVersion: "2026.10.18", privacyVersion: null, agreementVersion: "beta-x" },
      { context: "beta_agreement", termsVersion: null, privacyVersion: null, agreementVersion: "bad version!" },
      { context: "merchant_registration", termsVersion: null, privacyVersion: "2026.10.18", agreementVersion: null },
      { context: "merchant_registration", termsVersion: "2026.10.18", privacyVersion: "2026.10.18", agreementVersion: "beta-2026.11.20" },
      { context: "something_else", termsVersion: "2026.10.18", privacyVersion: "2026.10.18", agreementVersion: null },
    ];
    for (const values of rejected) {
      await expect(insertRaw({ ...base, ...values }), JSON.stringify(values)).rejects.toThrow(/check constraint/iu);
    }
  });

  it("keeps one acceptance per user, vendor and version while a vendor deletion keeps the record", async () => {
    const vendor = await createVendor("Unique");
    const user = await createUser("UniqueUser");
    const row = { userId: user.id, vendorId: vendor.id, context: "beta_agreement", termsVersion: null, privacyVersion: null, agreementVersion: "beta-2026.11.20" };
    await insertRaw(row);
    await expect(insertRaw(row)).rejects.toThrow(/23505[\s\S]*Key \("userId", "vendorId", context, "agreementVersion"\)/u);
    await expect(insertRaw({ ...row, agreementVersion: "beta-2027.01.01" })).resolves.toBe(1);

    await db.vendor.delete({ where: { id: vendor.id } });
    vendorIds.splice(vendorIds.indexOf(vendor.id), 1);
    expect(await db.userPolicyConsent.count({ where: { userId: user.id, context: "beta_agreement", vendorId: null } })).toBe(2);
  });
});
