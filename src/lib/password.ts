import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

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
  const parsed = parseStoredHash(storedHash);
  if (!parsed) return false;

  const actual = await derivePasswordKey(password, parsed.salt);
  return parsed.expected.length === actual.length && timingSafeEqual(parsed.expected, actual);
}
