import { scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const DEFAULT_SALT = "celebrate-deal-mvp";

export function hashPassword(password: string, salt = DEFAULT_SALT) {
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, hash] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
