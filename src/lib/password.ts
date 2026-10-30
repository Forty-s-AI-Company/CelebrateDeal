import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/**
 * Prefix of a stored password that can never match: written when an account's
 * password must stop working until its owner completes a password reset to
 * the account's address (e.g. after a login email change was reverted).
 * Verification still derives a key so the response time does not reveal it.
 */
const UNUSABLE_PASSWORD_PREFIX = "unusable:";
const UNUSABLE_TIMING_SALT = "0".repeat(32);

export type UnusablePasswordReason = "account_email_revert" | "support_mfa_removal";

/** A `passwordHash` value no password verifies against. Only a password reset replaces it. */
export function unusablePasswordHash(reason: UnusablePasswordReason) {
  return `${UNUSABLE_PASSWORD_PREFIX}${reason}`;
}

export function isUnusablePasswordHash(storedHash: string) {
  return storedHash.startsWith(UNUSABLE_PASSWORD_PREFIX);
}

function parseStoredHash(storedHash: string) {
  const [algorithm, salt, hash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash || !/^[a-f0-9]+$/i.test(hash)) {
    return null;
  }

  return { salt, expected: Buffer.from(hash, "hex") };
}

function derivePasswordKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  if (isUnusablePasswordHash(storedHash)) {
    scryptSync(password, UNUSABLE_TIMING_SALT, KEY_LENGTH);
    return false;
  }
  const parsed = parseStoredHash(storedHash);
  if (!parsed) return false;

  const actual = scryptSync(password, parsed.salt, KEY_LENGTH);
  return parsed.expected.length === actual.length && timingSafeEqual(parsed.expected, actual);
}

export async function hashPasswordAsync(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  const hash = await derivePasswordKey(password, salt);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function verifyPasswordAsync(password: string, storedHash: string) {
  if (isUnusablePasswordHash(storedHash)) {
    await derivePasswordKey(password, UNUSABLE_TIMING_SALT);
    return false;
  }
  const parsed = parseStoredHash(storedHash);
  if (!parsed) return false;

  const actual = await derivePasswordKey(password, parsed.salt);
  return parsed.expected.length === actual.length && timingSafeEqual(parsed.expected, actual);
}
