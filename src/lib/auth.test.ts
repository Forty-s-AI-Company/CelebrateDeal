import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createSession: vi.fn(),
  findSession: vi.fn(),
  findUser: vi.fn(),
  findWp4Member: vi.fn(),
  redirect: vi.fn(),
  updateUser: vi.fn(),
  verifyPasswordAsync: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    userSession: { create: mocks.createSession, findUnique: mocks.findSession },
    user: { findUnique: mocks.findUser, update: mocks.updateUser },
    vendorMember: { findFirst: mocks.findWp4Member },
  }),
}));
vi.mock("@/lib/mfa", () => ({ decryptMfaSecret: vi.fn() }));
vi.mock("@/lib/password", () => ({
  verifyPasswordAsync: mocks.verifyPasswordAsync,
}));

import {
  requireVendor,
  requireVendorContext,
  requireVendorOwner,
  authenticateUser,
  createUserSession,
  createWp4PreviewMfaVerifiedSession,
  getCurrentAuth,
  requireAuth,
  requireFinanceAdmin,
  requireVendorFinance,
  requireVendorManager,
  requireVendorManagerContext,
  requireVendorManagerMember,
  requireVendorOwnerFinance,
  requireVendorSupportContext,
  requireVendorSupportMember,
} from "@/lib/auth";

function sessionFor({
  platformRole,
  memberRole,
  mfaFactor = { id: "mfa-1" },
  mfaVerifiedAt = new Date("2026-07-21T00:00:00.000Z"),
}: {
  platformRole: string;
  memberRole?: string;
  mfaFactor?: { id: string } | null;
  mfaVerifiedAt?: Date | null;
}) {
  const memberships = memberRole
    ? [{
        id: "member-1",
        vendorId: "vendor-1",
        role: memberRole,
        status: "active",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        vendor: { id: "vendor-1", name: "商家一", tracking: null },
      }]
    : [];

  return {
    id: "session-1",
    vendorId: memberships[0]?.vendorId ?? null,
    revokedAt: null,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    mfaVerifiedAt,
    vendor: memberships[0]?.vendor ?? null,
    user: {
      id: "user-1",
      status: "active",
      platformRole,
      memberships,
      mfaFactor,
      recoveryCodes: [],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "test-session-token" }) });
  mocks.verifyPasswordAsync.mockResolvedValue(false);
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createUserSession", () => {
  it("keeps existing callers MFA-unverified", async () => {
    mocks.createSession.mockResolvedValue({ id: "session-1" });
    mocks.updateUser.mockResolvedValue({ id: "user-1" });

    await createUserSession({
      userId: "user-1",
      vendorId: "vendor-1",
    });

    expect(mocks.createSession).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        userId: "user-1",
        vendorId: "vendor-1",
        mfaVerifiedAt: null,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
  });

  it("only creates an MFA-verified session through the guarded WP4 helper", async () => {
    mocks.createSession.mockResolvedValue({ id: "session-1" });
    mocks.updateUser.mockResolvedValue({ id: "user-1" });
    mocks.findWp4Member.mockResolvedValue({ id: "synthetic-member" });
    vi.stubEnv("VERCEL_PROJECT_ID", "");
    vi.stubEnv("WP4_DISPOSABLE_RUNNER_MARKER", "verified-loopback");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3000");
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic:synthetic@127.0.0.1:5433/celebratedeal_test");
    vi.stubEnv("DIRECT_URL", "postgresql://synthetic:synthetic@127.0.0.1:5433/celebratedeal_test");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");

    await createWp4PreviewMfaVerifiedSession({ userId: "wp4_synthetic_owner_v1", vendorId: "wp4_synthetic_vendor_v1" });

    expect(mocks.createSession).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "wp4_synthetic_owner_v1",
        vendorId: "wp4_synthetic_vendor_v1",
        mfaVerifiedAt: expect.any(Date),
      }),
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    const expiresAt = mocks.createSession.mock.calls[0]?.[0].data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
  });

  it("refuses the WP4 helper outside the guarded preview sandbox", async () => {
    await expect(
      createWp4PreviewMfaVerifiedSession({ userId: "user-1", vendorId: "vendor-1" }),
    ).rejects.toThrow("WP4 preview session creation is disabled");

    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe("authenticateUser", () => {
  it("performs an asynchronous dummy password derivation for an unknown account", async () => {
    mocks.findUser.mockResolvedValue(null);

    await expect(authenticateUser("unknown@example.test", "candidate-password")).resolves.toBeNull();

    expect(mocks.verifyPasswordAsync).toHaveBeenCalledExactlyOnceWith(
      "candidate-password",
      expect.stringMatching(/^scrypt:/),
    );
  });

  it("does not authenticate an inactive account after equivalent password work", async () => {
    mocks.findUser.mockResolvedValue({
      id: "user-1",
      status: "suspended",
      passwordHash: "scrypt:stored-user-hash",
      memberships: [],
      mfaFactor: null,
      recoveryCodes: [],
    });
    mocks.verifyPasswordAsync.mockResolvedValue(true);

    await expect(authenticateUser("member@example.test", "candidate-password")).resolves.toBeNull();

    expect(mocks.verifyPasswordAsync).toHaveBeenCalledWith(
      "candidate-password",
      "scrypt:stored-user-hash",
    );
  });
});

describe("voluntary MFA session boundary", () => {
  it("keeps a pending or absent factor optional even with no verified timestamp", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "owner", mfaFactor: null, mfaVerifiedAt: null }));

    await expect(getCurrentAuth()).resolves.toMatchObject({ user: { id: "user-1" }, isMfaVerified: false });
    await expect(requireAuth()).resolves.toMatchObject({ user: { id: "user-1" } });
  });

  it("hides an enabled but unverified actor from direct API callers", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "owner", mfaVerifiedAt: null }));

    await expect(getCurrentAuth()).resolves.toBeNull();
    await expect(requireAuth()).rejects.toThrow("redirect:/mfa/verify?next=%2Fdashboard");
    await expect(requireAuth({ allowUnverifiedMfa: true })).resolves.toMatchObject({ user: { id: "user-1" } });
  });
});

describe("requireFinanceAdmin", () => {
  it("allows a platform administrator with an enrolled and verified MFA factor", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin", mfaFactor: { id: "mfa-1" } }));

    await expect(requireFinanceAdmin()).resolves.toMatchObject({
      isPlatformAdmin: true,
      member: { id: "user-1", role: "platform_admin" },
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin", "accountant"])(
    "rejects a vendor %s from the cross-tenant platform finance area",
    async (memberRole) => {
      mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

      await expect(requireFinanceAdmin()).rejects.toThrow("redirect:/dashboard");
      expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
    },
  );

  it.each([
    ["no verification timestamp", null],
    ["a stale verification timestamp", new Date("2026-07-21T00:00:00.000Z")],
  ] as const)("sends a platform administrator without an MFA factor to enrollment with %s", async (_label, mfaVerifiedAt) => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin", mfaFactor: null, mfaVerifiedAt }));

    await expect(requireFinanceAdmin()).rejects.toThrow("redirect:/mfa/setup?next=%2Fadmin%2Fbilling%2Fdashboard");
    // Setup and its enrollment actions must remain reachable without a factor.
    await expect(requireAuth()).resolves.toMatchObject({ isPlatformAdmin: true });
  });

  it("rejects a non-platform user without an MFA factor to the dashboard before the MFA check", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "owner", mfaFactor: null, mfaVerifiedAt: null }));

    await expect(requireFinanceAdmin()).rejects.toThrow("redirect:/dashboard");
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("still requires MFA verification for a platform administrator", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin", mfaVerifiedAt: null }));

    await expect(requireFinanceAdmin()).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Fadmin%2Fbilling%2Fdashboard",
    );
  });
});

describe("requireVendorManager", () => {
  it.each(["owner", "admin"])("allows an active vendor %s to manage operational data", async (memberRole) => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

    await expect(requireVendorManager()).resolves.toMatchObject({ id: "vendor-1" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("retains the authenticated actor for attributable operational audits", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "admin" }));

    await expect(requireVendorManagerContext()).resolves.toMatchObject({
      auth: { user: { id: "user-1" }, member: { id: "member-1", role: "admin" } },
      vendor: { id: "vendor-1" },
    });
  });

  it("rejects an accountant from operational write access", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "accountant" }));

    await expect(requireVendorManager()).rejects.toThrow("redirect:/dashboard?error=insufficient_role");
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard?error=insufficient_role");
  });
});

describe("requireVendorManagerMember", () => {
  it.each(["owner", "admin"])(
    "allows an MFA-verified vendor %s to cross the order PII boundary",
    async (memberRole) => {
      mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

      await expect(requireVendorManagerMember("/orders/order-1")).resolves.toMatchObject({
        user: { id: "user-1" },
        vendor: { id: "vendor-1" },
        member: { id: "member-1", role: memberRole },
      });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("keeps accountants outside the operational order boundary", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "accountant" }));

    await expect(requireVendorManagerMember()).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("keeps support outside the operational order boundary", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "support" }));

    await expect(requireVendorManagerMember()).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("does not let a path value turn support into a manager", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "support" }));

    await expect(requireVendorManagerMember("/support-cases/case-1")).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("allows an unenrolled manager into their tenant's order data", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "owner", mfaFactor: null, mfaVerifiedAt: null }),
    );

    await expect(requireVendorManagerMember()).resolves.toMatchObject({ vendor: { id: "vendor-1" } });
  });

  it("requires current-session MFA and rejects an external next path", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "admin", mfaVerifiedAt: null }),
    );

    await expect(requireVendorManagerMember("/orders/order-1")).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Forders%2Forder-1",
    );
    await expect(requireVendorManagerMember("//attacker.example")).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Forders",
    );
  });
});

describe("requireVendorSupportMember", () => {
  it.each(["owner", "admin", "support"])(
    "allows an MFA-verified active vendor %s into support operations",
    async (memberRole) => {
      mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

      await expect(requireVendorSupportMember("/support-cases/case-1")).resolves.toMatchObject({
        vendor: { id: "vendor-1" },
        member: { role: memberRole },
      });
    },
  );

  it.each(["accountant", "member"])("rejects a non-support %s before returning support context", async (memberRole) => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

    await expect(requireVendorSupportContext()).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("allows unenrolled support and challenges enabled support with a safe next path", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "support", mfaFactor: null, mfaVerifiedAt: null }),
    );
    await expect(requireVendorSupportMember()).resolves.toMatchObject({ member: { role: "support" } });

    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "support", mfaVerifiedAt: null }),
    );
    await expect(requireVendorSupportMember("//attacker.example")).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Fsupport-cases",
    );
  });
});

describe("requireVendorFinance", () => {
  it.each(["owner", "admin", "accountant"])(
    "allows an MFA-verified active vendor %s into tenant finance routes",
    async (memberRole) => {
      mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

      await expect(requireVendorFinance("/billing/invoices")).resolves.toMatchObject({
        vendor: { id: "vendor-1" },
        member: { role: memberRole },
      });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-finance member before any tenant billing data is returned", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "member" }));

    await expect(requireVendorFinance("/billing/invoices")).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("keeps support outside tenant finance while preserving accountant access", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "support" }));
    await expect(requireVendorFinance("/billing/invoices")).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );

    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "accountant" }));
    await expect(requireVendorFinance("/billing/invoices")).resolves.toMatchObject({
      member: { role: "accountant" },
    });
  });

  it("allows unenrolled tenant finance roles", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "accountant", mfaFactor: null, mfaVerifiedAt: null }),
    );

    await expect(requireVendorFinance("/billing/invoices")).resolves.toMatchObject({ member: { role: "accountant" } });
  });

  it("requires current-session MFA verification and preserves only a safe internal next path", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "owner", mfaVerifiedAt: null }),
    );

    await expect(requireVendorFinance("/billing/payouts")).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Fbilling%2Fpayouts",
    );
    await expect(requireVendorFinance("//attacker.example")).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Fbilling%2Fusage",
    );
  });

  it("keeps plan changes owner-only after the finance and MFA gates", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "accountant" }),
    );

    await expect(requireVendorOwnerFinance()).rejects.toThrow(
      "redirect:/settings/security?error=owner_required",
    );
  });
});

function membership(id: string, vendorId: string, role: string, createdAt: string, status = "active") {
  return { id, vendorId, role, status, createdAt: new Date(createdAt), vendor: { id: vendorId, name: vendorId, tracking: null } };
}

function sessionWithMemberships(memberships: ReturnType<typeof membership>[], sessionVendorId: string | null, mfa: { mfaFactor?: { id: string } | null; mfaVerifiedAt?: Date | null } = {}) {
  return {
    id: "session-1",
    vendorId: sessionVendorId,
    revokedAt: null,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    mfaVerifiedAt: "mfaVerifiedAt" in mfa ? mfa.mfaVerifiedAt : new Date("2026-07-21T00:00:00.000Z"),
    vendor: null,
    user: { id: "user-1", status: "active", platformRole: "none", memberships, mfaFactor: "mfaFactor" in mfa ? mfa.mfaFactor : { id: "mfa-1" }, recoveryCodes: [] },
  };
}

describe("vendor partner role boundary", () => {
  const partnerOnly = () => sessionWithMemberships([membership("member-p", "vendor-1", "partner", "2026-01-01T00:00:00Z")], "vendor-1");

  it("never turns a partner membership into the vendor context, even when the session names it", async () => {
    mocks.findSession.mockResolvedValue(partnerOnly());

    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: null, member: null, partnerPortalOnly: true, user: { id: "user-1" } });
    // The partner portal guard (requireAuth) still accepts the account.
    await expect(requireAuth({ nextPath: "/affiliate-portal" })).resolves.toMatchObject({ partnerPortalOnly: true });
  });

  it.each([
    ["requireVendorContext", () => requireVendorContext()],
    ["requireVendor", () => requireVendor()],
    ["requireVendorManager", () => requireVendorManager()],
    ["requireVendorManagerContext", () => requireVendorManagerContext()],
    ["requireVendorManagerMember", () => requireVendorManagerMember()],
    ["requireVendorSupportContext", () => requireVendorSupportContext()],
    ["requireVendorSupportMember", () => requireVendorSupportMember()],
    ["requireVendorFinance", () => requireVendorFinance()],
    ["requireVendorOwnerFinance", () => requireVendorOwnerFinance()],
    ["requireVendorOwner", () => requireVendorOwner()],
  ])("%s sends a partner to the partner portal", async (_name, guard) => {
    mocks.findSession.mockResolvedValue(partnerOnly());

    await expect(guard()).rejects.toThrow("redirect:/affiliate-portal");
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });

  it("keeps the platform finance area closed to partners", async () => {
    mocks.findSession.mockResolvedValue(partnerOnly());
    await expect(requireFinanceAdmin()).rejects.toThrow("redirect:/dashboard");
  });

  it("verifies an enrolled partner's MFA before the portal", async () => {
    mocks.findSession.mockResolvedValue(sessionWithMemberships([membership("member-p", "vendor-1", "partner", "2026-01-01T00:00:00Z")], "vendor-1", { mfaVerifiedAt: null }));

    await expect(getCurrentAuth()).resolves.toBeNull();
    await expect(requireAuth()).rejects.toThrow("redirect:/mfa/verify?next=%2Faffiliate-portal");
    await expect(requireVendorContext()).rejects.toThrow("redirect:/mfa/verify?next=%2Faffiliate-portal");
  });

  it("selects the back-office membership of an account that is a partner elsewhere", async () => {
    // Partner in vendor-1 (older, and named by the session), support in vendor-2.
    mocks.findSession.mockResolvedValue(sessionWithMemberships([
      membership("member-p", "vendor-1", "partner", "2026-01-01T00:00:00Z"),
      membership("member-s", "vendor-2", "support", "2026-02-01T00:00:00Z"),
    ], "vendor-1"));

    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: { id: "vendor-2" }, member: { id: "member-s", role: "support" }, partnerPortalOnly: false });
    await expect(requireVendorSupportContext()).resolves.toMatchObject({ vendor: { id: "vendor-2" } });
  });

  it.each(["member", "editor", "manager"])("keeps a legacy or unknown %s role as the vendor context for the role guards to judge", async (role) => {
    mocks.findSession.mockResolvedValue(sessionWithMemberships([membership("member-x", "vendor-1", role, "2026-01-01T00:00:00Z")], "vendor-1"));

    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: { id: "vendor-1" }, member: { role }, partnerPortalOnly: false });
    await expect(requireVendorContext()).resolves.toMatchObject({ vendor: { id: "vendor-1" } });
    await expect(requireVendorManagerContext()).rejects.toThrow("redirect:/dashboard?error=insufficient_role");
  });

  it("prefers a legacy role over a partner membership elsewhere", async () => {
    mocks.findSession.mockResolvedValue(sessionWithMemberships([
      membership("member-p", "vendor-1", "partner", "2026-01-01T00:00:00Z"),
      membership("member-x", "vendor-2", "member", "2026-02-01T00:00:00Z"),
    ], "vendor-1"));

    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: { id: "vendor-2" }, member: { role: "member" }, partnerPortalOnly: false });
  });

  it("does not treat an inactive partner membership as portal-only", async () => {
    mocks.findSession.mockResolvedValue(sessionWithMemberships([membership("member-p", "vendor-1", "partner", "2026-01-01T00:00:00Z", "inactive")], "vendor-1"));

    await expect(getCurrentAuth()).resolves.toMatchObject({ vendor: null, partnerPortalOnly: false });
    await expect(requireVendorContext()).rejects.toThrow("redirect:/login?error=no_vendor");
  });

  it("authenticates a partner-only account for the portal and names the partner vendor for its session", async () => {
    mocks.verifyPasswordAsync.mockResolvedValue(true);
    mocks.findUser.mockResolvedValue({
      id: "user-1", status: "active", platformRole: "none", passwordHash: "scrypt:stored",
      memberships: [membership("member-p", "vendor-1", "partner", "2026-01-01T00:00:00Z")], mfaFactor: null, recoveryCodes: [],
    });
    await expect(authenticateUser("partner@example.test", "candidate")).resolves.toMatchObject({ vendor: null, member: null, partnerPortalOnly: true, partnerVendorId: "vendor-1" });

    mocks.findUser.mockResolvedValue({
      id: "user-1", status: "active", platformRole: "none", passwordHash: "scrypt:stored",
      memberships: [membership("member-p", "vendor-1", "partner", "2026-01-01T00:00:00Z"), membership("member-o", "vendor-2", "owner", "2026-02-01T00:00:00Z")], mfaFactor: null, recoveryCodes: [],
    });
    await expect(authenticateUser("partner@example.test", "candidate")).resolves.toMatchObject({ vendor: { id: "vendor-2" }, member: { role: "owner" }, partnerPortalOnly: false, partnerVendorId: null });
  });
});
