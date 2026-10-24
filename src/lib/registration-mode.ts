/**
 * Merchant self-registration mode (closed beta, owner decision 2026-10-25).
 *
 * `invite` (default): `/register` only creates an account for a valid,
 * email-bound invitation signed by the platform (see
 * `merchant-registration-invite.ts`). `open`: anyone may register, as before.
 *
 * Fail closed: an unset, blank or unknown value is `invite`. Switch to `open`
 * only at public launch, after merchant email verification and bot protection
 * exist.
 */
export const REGISTRATION_MODE_ENV = "REGISTRATION_MODE";
export const REGISTRATION_MODES = ["invite", "open"] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

/** Shown wherever self-registration is closed. */
export const REGISTRATION_INVITE_ONLY_MESSAGE = "封測期間僅限受邀商家註冊。請使用平台寄給你的邀請連結。";

export function parseRegistrationMode(value: string | undefined | null): RegistrationMode {
  return value?.trim().toLowerCase() === "open" ? "open" : "invite";
}

export function registrationMode(env: NodeJS.ProcessEnv = process.env): RegistrationMode {
  return parseRegistrationMode(env[REGISTRATION_MODE_ENV]);
}
