import { COMMON_PASSWORDS, COMMON_PASSWORD_BASES } from "@/lib/password-policy-common";

/**
 * The one rule for a password a person chooses for themselves: registration,
 * the settings page, password reset and accepting a member invitation. Length
 * plus a common-password check, with no character-class rules. A platform
 * administrator needs 12 characters on every one of those paths. Sign-in never
 * applies it, so older accounts keep working. The bootstrap scripts keep their
 * own rules (platform administrator bootstrap 12 characters, staging QA finance
 * bootstrap 24 characters) and are not changed by this module.
 *
 * Nothing here logs, stores or returns the password.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/** Upper bound on raw input before any work, so oversized bodies stay cheap. Above it the result is "long". */
export const PASSWORD_INPUT_LIMIT = 1024;

export type PasswordPolicyReason = "short" | "long" | "common" | "personal";
export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: "short"; minLength: number }
  | { ok: false; reason: Exclude<PasswordPolicyReason, "short"> };
export type PasswordPolicyFailure = Extract<PasswordPolicyResult, { ok: false }>;
export type PasswordPolicyContext = { email?: string | null; platformRole?: string | null };

export const PASSWORD_HINT = "至少 8 個字元，可以用一句好記的話。";
export const ADMIN_PASSWORD_HINT = "平台管理員至少 12 個字元，可以用一句好記的話。";

/** Fixed copy keyed by the error code a page receives; see passwordPolicyErrorCode. */
export const PASSWORD_POLICY_MESSAGES = {
  short: "密碼至少需要 8 個字元。",
  admin_short: "管理員密碼至少需要 12 個字元。",
  long: "密碼最多 128 個字元。",
  common: "這個密碼太常見，請換一個。",
  personal: "密碼不要包含你的 Email 帳號名稱。",
} as const;
export type PasswordPolicyErrorCode = keyof typeof PASSWORD_POLICY_MESSAGES;

export function passwordMinLength(platformRole: string | null | undefined) {
  return platformRole === "platform_admin" ? ADMIN_PASSWORD_MIN_LENGTH : PASSWORD_MIN_LENGTH;
}

/** The hint shown beside a new-password field for this platform role. */
export function passwordHint(platformRole: string | null | undefined) {
  return passwordMinLength(platformRole) > PASSWORD_MIN_LENGTH ? ADMIN_PASSWORD_HINT : PASSWORD_HINT;
}

/** The redirect/error code for a failure; an administrator's short password gets its own copy. */
export function passwordPolicyErrorCode(result: PasswordPolicyFailure): PasswordPolicyErrorCode {
  return result.reason === "short" && result.minLength > PASSWORD_MIN_LENGTH ? "admin_short" : result.reason;
}

const COMMON_PASSWORD_SET: ReadonlySet<string> = new Set(COMMON_PASSWORDS);
const COMMON_BASE_SET: ReadonlySet<string> = new Set([...COMMON_PASSWORDS, ...COMMON_PASSWORD_BASES]);
// Wrap-around digits so 34567890 and 90123456 count as runs too.
const SEQUENCES = [
  "01234567890123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
].flatMap((sequence) => [sequence, [...sequence].reverse().join("")]);
/** A weak core must still be this long after an end is trimmed, so ordinary passwords are not caught. */
const MIN_WEAK_CORE_LENGTH = 6;
const MAX_TRIMMED_END = 4;
const MIN_EMAIL_NAME_LENGTH = 4;
/** Shared mailbox names: a password containing these says nothing about the person. */
const ROLE_EMAIL_NAMES: ReadonlySet<string> = new Set([
  "info", "sales", "admin", "support", "service", "hello", "contact", "shop", "store", "office", "team",
  "mail", "help", "billing", "order", "orders", "marketing", "enquiry", "inquiry", "noreply", "contactus",
  "customer", "account", "accounts", "finance", "booking", "reservation", "webmaster",
]);

/** One short unit repeated: 11111111, abababab, 123123123, passpass. */
function isRepeatedUnit(value: string) {
  return /^([\s\S]{1,4})\1+$/u.test(value);
}

/** The whole value is one straight run, forwards or backwards. */
function isStraightSequence(value: string) {
  return SEQUENCES.some((sequence) => sequence.includes(value));
}

function isWeakPattern(chars: string[]) {
  if (chars.length < MIN_WEAK_CORE_LENGTH) return false;
  const value = chars.join("");
  return isRepeatedUnit(value) || isStraightSequence(value);
}

/**
 * A repeat or a straight run with up to four characters added at either end:
 * 12345678!, 11111111a, aaaaaaa1, abc123456789, qwertyuiop1.
 */
function isPaddedPattern(chars: string[]) {
  if (isWeakPattern(chars)) return true;
  for (let trimmed = 1; trimmed <= MAX_TRIMMED_END; trimmed += 1) {
    if (isWeakPattern(chars.slice(0, -trimmed)) || isWeakPattern(chars.slice(trimmed))) return true;
  }
  return false;
}

/** A listed word or base word with only digits or symbols around it: qwerty2026, admin2026!, 2026password. */
function isListedWordWithDigits(value: string) {
  if (COMMON_PASSWORD_SET.has(value)) return true;
  const core = value.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  return core !== value && COMMON_BASE_SET.has(core);
}

function compact(value: string) {
  return value.replace(/[._\-\s]+/gu, "");
}

/** The e-mail name without its +tag, with dots, dashes and underscores ignored on both sides. */
function containsEmailName(value: string, email: string | null | undefined) {
  const local = (email ?? "").normalize("NFKC").trim().toLowerCase().split("@")[0] ?? "";
  const name = compact(local.split("+")[0] ?? "");
  if ([...name].length < MIN_EMAIL_NAME_LENGTH || ROLE_EMAIL_NAMES.has(name)) return false;
  return compact(value).includes(name);
}

export function validateNewPassword(password: string, context: PasswordPolicyContext = {}): PasswordPolicyResult {
  // Bound the work on oversized input before normalising it.
  if (password.length > PASSWORD_INPUT_LIMIT) return { ok: false, reason: "long" };
  // NFKC folds full-width and compatibility forms (ｐａｓｓｗｏｒｄ) before any comparison.
  const normalized = password.normalize("NFKC").trim().toLowerCase();
  // Count characters, not UTF-16 code units, so four emoji are four characters.
  const chars = Array.from(normalized);
  if (chars.length > PASSWORD_MAX_LENGTH) return { ok: false, reason: "long" };
  const minLength = passwordMinLength(context.platformRole);
  if (chars.length < minLength) return { ok: false, reason: "short", minLength };
  if (isListedWordWithDigits(normalized) || isPaddedPattern(chars)) return { ok: false, reason: "common" };
  if (containsEmailName(normalized, context.email)) return { ok: false, reason: "personal" };
  return { ok: true };
}
