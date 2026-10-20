import { createHmac } from "node:crypto";

/**
 * Staging finance QA runners sign in as the fixed synthetic platform admin.
 * Since WP-10 (F-024) a platform admin without an enrolled factor is sent to
 * /mfa/setup, so every runner needs the shared TOTP seed that
 * scripts/bootstrap-staging-qa-finance.ts enrolled. The seed lives only in the
 * protected GitHub environment secret; it is never logged, written to a
 * receipt, or committed. Only fixed explanatory text and closed categories
 * leave this module.
 */
export const QA_FINANCE_TOTP_ENV = "PAYUNI_QA_FINANCE_TOTP_SECRET";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Must match src/lib/mfa.ts (RFC 6238, HMAC-SHA1, 6 digits, 30 seconds).
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;

const EXPLANATIONS = {
  SEED_MISSING: `${QA_FINANCE_TOTP_ENV} is not set. Staging finance QA requires the TOTP seed enrolled by the QA finance bootstrap; MFA is never bypassed.`,
  SEED_INVALID: `${QA_FINANCE_TOTP_ENV} is not a base32 TOTP seed of at least 160 bits.`,
  NOT_ENROLLED: "The QA finance account has no MFA factor and was sent to /mfa/setup. Run the staging QA finance bootstrap with the TOTP seed first; runners never enroll a server-generated secret.",
  NOT_COMPLETED: "MFA verification with the configured TOTP seed did not complete.",
};

export class QaFinanceMfaError extends Error {
  constructor(category) {
    super(`QA_FINANCE_MFA_${category}`);
    this.name = "QaFinanceMfaError";
    this.category = category;
  }
}

function fail(category, log) {
  // Fixed text only: no seed, code, URL, cookie or page content.
  log?.(`[qa-finance-mfa] ${EXPLANATIONS[category]}`);
  return new QaFinanceMfaError(category);
}

const defaultLog = (line) => console.error(line);

/** Returns the normalized seed or throws a closed, explained failure. */
export function requireQaFinanceTotpSeed(env = process.env, { log = defaultLog } = {}) {
  const raw = env?.[QA_FINANCE_TOTP_ENV];
  if (typeof raw !== "string" || !raw.trim()) throw fail("SEED_MISSING", log);
  const seed = raw.replace(/\s+/gu, "").replace(/=+$/u, "").toUpperCase();
  // 32 base32 characters = 160 bits, the size src/lib/mfa.ts generates.
  if (!/^[A-Z2-7]{32,128}$/u.test(seed)) throw fail("SEED_INVALID", log);
  return seed;
}

function base32Decode(seed) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of seed) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new QaFinanceMfaError("SEED_INVALID");
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 code for the given time; identical to src/lib/mfa.ts. */
export function qaFinanceTotpCode(seed, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(seed)).update(counterBytes).digest();
  const offset = digest.readUInt8(digest.length - 1) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

/**
 * Completes the MFA step after the password login redirect settled.
 * - /mfa/verify: submits the current TOTP code computed from the seed.
 * - /mfa/setup: fails closed. Enrollment through the UI would store a
 *   server-generated secret that no later run could reproduce, so the
 *   bootstrap is the only place that enrolls the shared seed.
 * Returns true when a code was submitted, false when no MFA page was shown.
 */
export async function completeQaFinanceMfa(page, { seed, waitAfterMfa, now = Date.now, log = defaultLog }) {
  const pathname = new URL(page.url()).pathname;
  if (pathname === "/mfa/setup") throw fail("NOT_ENROLLED", log);
  if (pathname !== "/mfa/verify") return false;
  await page.locator('input[name="code"]').fill(qaFinanceTotpCode(seed, now()));
  await page.getByRole("button", { name: "確認並繼續", exact: true }).click();
  await waitAfterMfa();
  if (new URL(page.url()).pathname.startsWith("/mfa/")) throw fail("NOT_COMPLETED", log);
  return true;
}
