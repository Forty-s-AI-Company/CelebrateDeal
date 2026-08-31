import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  createSession: vi.fn(),
  findSession: vi.fn(),
  findUser: vi.fn(),
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
  }),
}));
vi.mock("@/lib/mfa", () => ({ decryptMfaSecret: vi.fn() }));
vi.mock("@/lib/password", () => ({
  verifyPasswordAsync: mocks.verifyPasswordAsync,
}));

import {
  authenticateUser,
  createUserSession,
  createWp4PreviewMfaVerifiedSession,
  requireFinanceAdmin,
  requireVendorFinance,
  requireVendorManager,
  requireVendorManagerContext,
  requireVendorManagerMfa,
  requireVendorOwnerFinance,
  requireVendorSupportContext,
  requireVendorSupportMfa,
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
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");

    await createWp4PreviewMfaVerifiedSession({ userId: "user-1", vendorId: "vendor-1" });

    expect(mocks.createSession).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        vendorId: "vendor-1",
        mfaVerifiedAt: expect.any(Date),
      }),
    });
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

describe("requireFinanceAdmin", () => {
  it("allows an MFA-verified platform administrator", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin" }));

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

  it("still requires MFA setup for a platform administrator", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "platform_admin", mfaFactor: null }));

    await expect(requireFinanceAdmin()).rejects.toThrow("redirect:/mfa/setup");
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

describe("requireVendorManagerMfa", () => {
  it.each(["owner", "admin"])(
    "allows an MFA-verified vendor %s to cross the order PII boundary",
    async (memberRole) => {
      mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

      await expect(requireVendorManagerMfa("/orders/order-1")).resolves.toMatchObject({
        user: { id: "user-1" },
        vendor: { id: "vendor-1" },
        member: { id: "member-1", role: memberRole },
      });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("keeps accountants outside the operational order boundary", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "accountant" }));

    await expect(requireVendorManagerMfa()).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("keeps support outside the operational order boundary", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "support" }));

    await expect(requireVendorManagerMfa()).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("does not let a path value turn support into a manager", async () => {
    mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole: "support" }));

    await expect(requireVendorManagerMfa("/support-cases/case-1")).rejects.toThrow(
      "redirect:/dashboard?error=insufficient_role",
    );
  });

  it("requires MFA enrollment before order PII may be revealed", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "owner", mfaFactor: null }),
    );

    await expect(requireVendorManagerMfa()).rejects.toThrow("redirect:/mfa/setup");
  });

  it("requires current-session MFA and rejects an external next path", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "admin", mfaVerifiedAt: null }),
    );

    await expect(requireVendorManagerMfa("/orders/order-1")).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Forders%2Forder-1",
    );
    await expect(requireVendorManagerMfa("//attacker.example")).rejects.toThrow(
      "redirect:/mfa/verify?next=%2Forders",
    );
  });
});

describe("requireVendorSupportMfa", () => {
  it.each(["owner", "admin", "support"])(
    "allows an MFA-verified active vendor %s into support operations",
    async (memberRole) => {
      mocks.findSession.mockResolvedValue(sessionFor({ platformRole: "none", memberRole }));

      await expect(requireVendorSupportMfa("/support-cases/case-1")).resolves.toMatchObject({
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

  it("requires MFA enrollment and a safe internal next path", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "support", mfaFactor: null }),
    );
    await expect(requireVendorSupportMfa()).rejects.toThrow("redirect:/mfa/setup");

    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "support", mfaVerifiedAt: null }),
    );
    await expect(requireVendorSupportMfa("//attacker.example")).rejects.toThrow(
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

  it("requires MFA enrollment for tenant finance roles", async () => {
    mocks.findSession.mockResolvedValue(
      sessionFor({ platformRole: "none", memberRole: "accountant", mfaFactor: null }),
    );

    await expect(requireVendorFinance("/billing/invoices")).rejects.toThrow("redirect:/mfa/setup");
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
