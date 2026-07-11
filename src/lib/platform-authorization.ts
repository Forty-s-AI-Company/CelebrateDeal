export type PlatformAdminAuthorizationFailure =
  | "platform_role_required"
  | "mfa_setup_required"
  | "mfa_verification_required";

export function getPlatformAdminAuthorizationFailure(input: {
  platformRole: string | null | undefined;
  hasMfaFactor: boolean;
  isMfaVerified: boolean;
}): PlatformAdminAuthorizationFailure | null {
  if (input.platformRole !== "platform_admin") {
    return "platform_role_required";
  }

  if (!input.hasMfaFactor) {
    return "mfa_setup_required";
  }

  if (!input.isMfaVerified) {
    return "mfa_verification_required";
  }

  return null;
}
