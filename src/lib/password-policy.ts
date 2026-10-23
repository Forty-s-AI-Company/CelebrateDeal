import { COMMON_PASSWORDS } from "@/lib/password-policy-common";

/**
 * The one rule for a password a person chooses for themselves: registration,
 * the settings page, password reset and accepting a member invitation. Length
 * plus a common-password check, with no character-class rules. Sign-in never
 * applies it, so older accounts keep working. Platform administrator and QA
 * finance bootstrap passwords keep their own stricter 12-character rule.
 *
 * Nothing here logs, stores or returns the password.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordPolicyReason = "short" | "long" | "common";
export type PasswordPolicyResult = { ok: true } | { ok: false; reason: PasswordPolicyReason };
export type PasswordPolicyContext = { email?: string | null };

export const PASSWORD_HINT = "至少 8 個字元，可以用一句好記的話。";

export const PASSWORD_POLICY_MESSAGES: Record<PasswordPolicyReason, string> = {
  short: "密碼至少需要 8 個字元。",
  long: "密碼最多 128 個字元。",
  common: "這個密碼太常見，請換一個。",
};

const COMMON_PASSWORD_SET: ReadonlySet<string> = new Set(COMMON_PASSWORDS);
// Wrap-around digits so 34567890 and 90123456 count as runs too.
const SEQUENCES = [
  "01234567890123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
].flatMap((sequence) => [sequence, [...sequence].reverse().join("")]);
const MIN_EMAIL_NAME_LENGTH = 4;

/** One short unit repeated: 11111111, abababab, 123123123, passpass. */
function isRepeatedUnit(value: string) {
  return /^([\s\S]{1,4})\1+$/u.test(value);
}

/** The whole password is one straight run, forwards or backwards. */
function isStraightSequence(value: string) {
  return SEQUENCES.some((sequence) => sequence.includes(value));
}

/** A listed word with only digits or symbols added at the end, such as password2026!. */
function isListedWithSuffix(value: string) {
  const base = value.replace(/[^\p{L}]+$/u, "");
  return base !== value && COMMON_PASSWORD_SET.has(base);
}

function containsEmailName(value: string, email: string | null | undefined) {
  const name = email?.trim().toLowerCase().split("@")[0] ?? "";
  return name.length >= MIN_EMAIL_NAME_LENGTH && value.includes(name);
}

export function validateNewPassword(password: string, context: PasswordPolicyContext = {}): PasswordPolicyResult {
  // Bound the work on oversized input before normalising it.
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, reason: "long" };
  const normalized = password.trim().toLowerCase();
  if (normalized.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: "short" };
  if (
    COMMON_PASSWORD_SET.has(normalized)
    || isRepeatedUnit(normalized)
    || isStraightSequence(normalized)
    || isListedWithSuffix(normalized)
    || containsEmailName(normalized, context.email)
  ) {
    return { ok: false, reason: "common" };
  }
  return { ok: true };
}
