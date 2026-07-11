import { describe, expect, it } from "vitest";
import { getPlatformAdminAuthorizationFailure } from "@/lib/platform-authorization";

describe("platform admin authorization", () => {
  it.each([
    { actor: "vendor owner", platformRole: "none" },
    { actor: "vendor admin", platformRole: "none" },
    { actor: "vendor accountant", platformRole: "none" },
    { actor: "vendor member", platformRole: "none" },
    { actor: "unknown role", platformRole: null },
  ])(
    "rejects $actor even with verified MFA",
    ({ platformRole }) => {
      expect(
        getPlatformAdminAuthorizationFailure({
          platformRole,
          hasMfaFactor: true,
          isMfaVerified: true,
        }),
      ).toBe("platform_role_required");
    },
  );

  it("requires an MFA factor for platform admins", () => {
    expect(
      getPlatformAdminAuthorizationFailure({
        platformRole: "platform_admin",
        hasMfaFactor: false,
        isMfaVerified: false,
      }),
    ).toBe("mfa_setup_required");
  });

  it("requires MFA verification in the current platform admin session", () => {
    expect(
      getPlatformAdminAuthorizationFailure({
        platformRole: "platform_admin",
        hasMfaFactor: true,
        isMfaVerified: false,
      }),
    ).toBe("mfa_verification_required");
  });

  it("allows only a platform admin with configured and verified MFA", () => {
    expect(
      getPlatformAdminAuthorizationFailure({
        platformRole: "platform_admin",
        hasMfaFactor: true,
        isMfaVerified: true,
      }),
    ).toBeNull();
  });
});
