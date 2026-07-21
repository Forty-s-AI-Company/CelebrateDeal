import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  findSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ userSession: { findUnique: mocks.findSession } }),
}));
vi.mock("@/lib/mfa", () => ({ decryptMfaSecret: vi.fn() }));

import { requireFinanceAdmin } from "@/lib/auth";

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
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
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
