import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret, mfaSecretNeedsReencryption } from "../src/lib/mfa";
import { reencryptLegacyMfaSecret } from "../src/lib/mfa-secret-rotation";
import { deriveSensitiveDataKey } from "../src/lib/sensitive-data";
import {
  EXECUTE_CONFIRMATION,
  MfaReencryptRefusedError,
  PRODUCTION_APPROVAL,
  parseMfaReencryptArguments,
  planMfaReencryption,
  reencryptMfaSecrets,
  resolveMfaReencryptTarget,
  runMfaReencryption,
} from "./reencrypt-mfa-secrets";

const userIds: string[] = [];

/** The exact pre-rotation format: "<iv>.<tag>.<data>" under the old purpose. */
function legacyCiphertext(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveSensitiveDataKey("mfa-encryption"), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

async function createFactor(secretEncrypted: string) {
  const db = getDb();
  const suffix = randomUUID();
  const user = await db.user.create({
    data: { email: `mfa-rotation-${suffix}@example.test`, name: "Synthetic MFA rotation", passwordHash: "synthetic-only" },
  });
  userIds.push(user.id);
  await db.userMfaFactor.create({ data: { userId: user.id, factorType: "totp", secretEncrypted } });
  return user.id;
}

async function storedSecret(userId: string) {
  const factor = await getDb().userMfaFactor.findUniqueOrThrow({ where: { userId }, select: { secretEncrypted: true } });
  return factor.secretEncrypted;
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-mfa-rotation-root-secret-0123456789");
  vi.stubEnv("JOB_SECRET", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await getDb().user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

const executeOptions = { execute: true, target: null, batchSize: 2, allowUnreadable: false } as const;
const confirmed = { MFA_REENCRYPT_CONFIRM: EXECUTE_CONFIRMATION };

describe("scripts/reencrypt-mfa-secrets (PostgreSQL)", () => {
  it("plans without writing, then re-encrypts legacy rows idempotently", async () => {
    const legacySecrets = [generateTotpSecret(), generateTotpSecret(), generateTotpSecret()];
    const legacyUsers = await Promise.all(legacySecrets.map((secret) => createFactor(legacyCiphertext(secret))));
    const currentSecret = generateTotpSecret();
    const currentCiphertext = encryptMfaSecret(currentSecret);
    const currentUser = await createFactor(currentCiphertext);
    const scope = { userIds: [...legacyUsers, currentUser] };
    const before = await Promise.all(legacyUsers.map(storedSecret));

    const plan = await runMfaReencryption(getDb(), { ...executeOptions, execute: false }, {}, scope);
    expect(plan).toEqual({ mode: "plan", factors: 4, current: 1, legacy: 3, unreadable: 0 });
    expect(await Promise.all(legacyUsers.map(storedSecret))).toEqual(before);

    const first = await runMfaReencryption(getDb(), executeOptions, confirmed, scope);
    expect(first).toEqual({ mode: "execute", reencrypted: 3, alreadyCurrent: 1, changed: 0, unreadable: 0, remainingLegacy: 0, remainingUnreadable: 0 });
    for (const [index, userId] of legacyUsers.entries()) {
      const stored = await storedSecret(userId);
      expect(mfaSecretNeedsReencryption(stored)).toBe(false);
      expect(decryptMfaSecret(stored)).toBe(legacySecrets[index]);
    }
    // The already-current row is left byte-identical.
    expect(await storedSecret(currentUser)).toBe(currentCiphertext);

    const afterFirst = await Promise.all(scope.userIds.map(storedSecret));
    const second = await runMfaReencryption(getDb(), executeOptions, confirmed, scope);
    expect(second).toEqual({ mode: "execute", reencrypted: 0, alreadyCurrent: 4, changed: 0, unreadable: 0, remainingLegacy: 0, remainingUnreadable: 0 });
    expect(await Promise.all(scope.userIds.map(storedSecret))).toEqual(afterFirst);
  });

  it("requires the confirmation value and refuses unreadable rows unless allowed", async () => {
    const legacyUser = await createFactor(legacyCiphertext(generateTotpSecret()));
    const brokenUser = await createFactor("not.a.ciphertext");
    const scope = { userIds: [legacyUser, brokenUser] };
    const before = await Promise.all(scope.userIds.map(storedSecret));

    await expect(runMfaReencryption(getDb(), executeOptions, {}, scope)).rejects.toMatchObject({ category: "confirmation-missing" });
    await expect(runMfaReencryption(getDb(), executeOptions, confirmed, scope)).rejects.toMatchObject({ category: "unreadable-rows" });
    expect(await Promise.all(scope.userIds.map(storedSecret))).toEqual(before);

    const allowed = await runMfaReencryption(getDb(), { ...executeOptions, allowUnreadable: true }, confirmed, scope);
    expect(allowed).toMatchObject({ reencrypted: 1, unreadable: 1, remainingLegacy: 0, remainingUnreadable: 1 });
    expect(await storedSecret(brokenUser)).toBe("not.a.ciphertext");
  });

  it("writes nothing when run with another root key", async () => {
    const userId = await createFactor(legacyCiphertext(generateTotpSecret()));
    const before = await storedSecret(userId);
    vi.stubEnv("CSRF_SECRET", "a-different-synthetic-root-secret-0123456789");

    expect(await planMfaReencryption(getDb(), 10, { userIds: [userId] })).toMatchObject({ legacy: 0, unreadable: 1 });
    expect(await reencryptMfaSecrets(getDb(), 10, { userIds: [userId] })).toMatchObject({ reencrypted: 0, unreadable: 1 });
    expect(await storedSecret(userId)).toBe(before);
  });

  it("never overwrites a ciphertext that changed underneath the lazy path", async () => {
    const secret = generateTotpSecret();
    const legacy = legacyCiphertext(secret);
    const userId = await createFactor(legacy);
    const reenrolled = encryptMfaSecret(generateTotpSecret());
    await getDb().userMfaFactor.update({ where: { userId }, data: { secretEncrypted: reenrolled } });

    await expect(reencryptLegacyMfaSecret(getDb(), { userId, secretEncrypted: legacy })).resolves.toBe("changed");
    expect(await storedSecret(userId)).toBe(reenrolled);
  });

  it("lazily re-encrypts a legacy secret once and then reports it current", async () => {
    const secret = generateTotpSecret();
    const legacy = legacyCiphertext(secret);
    const userId = await createFactor(legacy);

    await expect(reencryptLegacyMfaSecret(getDb(), { userId, secretEncrypted: legacy })).resolves.toBe("reencrypted");
    const stored = await storedSecret(userId);
    expect(decryptMfaSecret(stored)).toBe(secret);
    await expect(reencryptLegacyMfaSecret(getDb(), { userId, secretEncrypted: stored })).resolves.toBe("current");
  });
});

describe("scripts/reencrypt-mfa-secrets target guard", () => {
  const loopback = "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public";
  const remote = "postgresql://user:pass@db.example.test:5432/celebratedeal?schema=public"; // secret-scan: allow-test-fixture (reserved .test host, fake credentials)

  it("allows a loopback disposable database without flags", () => {
    expect(resolveMfaReencryptTarget({ DATABASE_URL: loopback }, null)).toEqual({ url: loopback, target: "loopback" });
    expect(() => resolveMfaReencryptTarget({ DATABASE_URL: loopback }, "production")).toThrow(MfaReencryptRefusedError);
  });

  it("refuses remote databases unless the target and approval are explicit", () => {
    const refusal = (env: Record<string, string>, target: Parameters<typeof resolveMfaReencryptTarget>[1]) => {
      try {
        resolveMfaReencryptTarget(env, target);
        return "allowed";
      } catch (error) {
        return error instanceof MfaReencryptRefusedError ? error.category : "unexpected";
      }
    };
    expect(refusal({}, null)).toBe("missing");
    expect(refusal({ DATABASE_URL: remote }, null)).toBe("remote-without-target");
    expect(refusal({ DATABASE_URL: remote }, "staging")).toBe("not-staging");
    expect(refusal({ DATABASE_URL: remote }, "production")).toBe("production-not-approved");
    expect(refusal({ DATABASE_URL: remote, MFA_REENCRYPT_PRODUCTION_APPROVAL: "yes" }, "production")).toBe("production-not-approved");
    expect(refusal({ DATABASE_URL: "postgresql://postgres:postgres@localhost:54329/production?schema=public" }, null)).toBe("remote-without-target"); // secret-scan: allow-test-fixture (loopback DB intentionally misnamed)
    expect(resolveMfaReencryptTarget({ DATABASE_URL: remote, MFA_REENCRYPT_PRODUCTION_APPROVAL: PRODUCTION_APPROVAL }, "production"))
      .toEqual({ url: remote, target: "production" });
  });

  it("parses only the documented arguments", () => {
    expect(parseMfaReencryptArguments([])).toEqual({ execute: false, target: null, batchSize: 100, allowUnreadable: false });
    expect(parseMfaReencryptArguments(["--target=staging", "--execute", "--batch-size", "50", "--allow-unreadable"]))
      .toEqual({ execute: true, target: "staging", batchSize: 50, allowUnreadable: true });
    expect(() => parseMfaReencryptArguments(["--target=prod"])).toThrow(MfaReencryptRefusedError);
    expect(() => parseMfaReencryptArguments(["--batch-size", "0"])).toThrow(MfaReencryptRefusedError);
    expect(() => parseMfaReencryptArguments(["--force"])).toThrow(MfaReencryptRefusedError);
  });
});
