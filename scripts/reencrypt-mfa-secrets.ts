/**
 * B04-03 tier 4: re-encrypts every stored MFA secret under the current key.
 *
 * Secrets written before the derived-key rotation use the legacy
 * "<iv>.<tag>.<data>" format under the old key; new ones use "m2.". Sign-in
 * already re-encrypts lazily after a successful TOTP check; this one-off run
 * covers users who do not sign in. See docs/staging-production-env-vars.md §7.
 *
 * Safety (a guard against mistakes, not an access control):
 * - Dry run by default: prints counts only. Writing needs `--execute` AND
 *   MFA_REENCRYPT_CONFIRM=REENCRYPT_MFA_SECRETS.
 * - Target: a loopback `celebratedeal_*` database is always allowed. Staging
 *   needs `--target=staging` and a URL that is the staging database. Any other
 *   database needs `--target=production` AND
 *   MFA_REENCRYPT_PRODUCTION_APPROVAL=OWNER_APPROVED_PRODUCTION_MFA_REENCRYPT,
 *   which the operator sets only with the owner's explicit approval. The
 *   validated URL is pinned into the Prisma client.
 * - Every row is decrypted with the legacy key before anything is written, and
 *   the new ciphertext is checked to decrypt back to the same secret. A run
 *   with the wrong root key therefore writes nothing (rows count as
 *   unreadable). Unreadable rows block `--execute` unless
 *   `--allow-unreadable` is passed; they are then left untouched.
 * - Each write is a compare-and-swap on the old ciphertext: idempotent, safe to
 *   rerun after an interruption, and never overwrites a concurrent re-enrolment.
 * - Never prints secrets, ciphertext, user IDs or e-mail addresses.
 *
 * Usage (the target environment's root key must be injected by the operator):
 *   DATABASE_URL=<staging> node --import tsx scripts/reencrypt-mfa-secrets.ts --target=staging
 *   MFA_REENCRYPT_CONFIRM=REENCRYPT_MFA_SECRETS DATABASE_URL=<staging> \
 *     node --import tsx scripts/reencrypt-mfa-secrets.ts --target=staging --execute
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";
import { decryptMfaSecret, mfaSecretNeedsReencryption } from "../src/lib/mfa";
import { reencryptLegacyMfaSecret } from "../src/lib/mfa-secret-rotation";
import { classifyLocalTestDatabase } from "./local-database-safety";

export const EXECUTE_CONFIRMATION = "REENCRYPT_MFA_SECRETS";
export const PRODUCTION_APPROVAL = "OWNER_APPROVED_PRODUCTION_MFA_REENCRYPT";
const DEFAULT_BATCH_SIZE = 100;

type Environment = Readonly<Record<string, string | undefined>>;
type Db = Pick<PrismaClient, "userMfaFactor">;

export class MfaReencryptRefusedError extends Error {
  constructor(public readonly category: string) {
    super("MFA re-encryption refused.");
    this.name = "MfaReencryptRefusedError";
  }
}

export type MfaReencryptOptions = {
  execute: boolean;
  target: "loopback" | "staging" | "production" | null;
  batchSize: number;
  allowUnreadable: boolean;
};

export function parseMfaReencryptArguments(argv: readonly string[]): MfaReencryptOptions {
  const options: MfaReencryptOptions = { execute: false, target: null, batchSize: DEFAULT_BATCH_SIZE, allowUnreadable: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--execute") options.execute = true;
    else if (argument === "--allow-unreadable") options.allowUnreadable = true;
    else if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (target !== "loopback" && target !== "staging" && target !== "production") throw new MfaReencryptRefusedError("invalid-target");
      options.target = target;
    } else if (argument === "--batch-size") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 500) throw new MfaReencryptRefusedError("invalid-batch-size");
      options.batchSize = value;
      index += 1;
    } else {
      throw new MfaReencryptRefusedError("unknown-argument");
    }
  }
  return options;
}

/** Returns the database URL the tool may use, or throws a safe category. */
export function resolveMfaReencryptTarget(env: Environment, target: MfaReencryptOptions["target"]) {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new MfaReencryptRefusedError("missing");
  if (classifyLocalTestDatabase(url).safe) {
    if (target !== null && target !== "loopback") throw new MfaReencryptRefusedError("target-mismatch");
    return { url, target: "loopback" as const };
  }
  if (target === "staging") {
    if (!isStagingDatabaseUrl(url)) throw new MfaReencryptRefusedError("not-staging");
    return { url, target: "staging" as const };
  }
  if (target === "production") {
    if (isStagingDatabaseUrl(url)) throw new MfaReencryptRefusedError("target-mismatch");
    if (env.MFA_REENCRYPT_PRODUCTION_APPROVAL !== PRODUCTION_APPROVAL) throw new MfaReencryptRefusedError("production-not-approved");
    return { url, target: "production" as const };
  }
  throw new MfaReencryptRefusedError("remote-without-target");
}

/** Tests (and a targeted manual run) may restrict the scan to given users. */
export type MfaReencryptScope = { userIds?: readonly string[] };

async function forEachFactor(
  db: Db,
  batchSize: number,
  scope: MfaReencryptScope,
  visit: (factor: { id: string; userId: string; secretEncrypted: string }) => Promise<void> | void,
) {
  let cursor: string | undefined;
  while (true) {
    const factors = await db.userMfaFactor.findMany({
      where: {
        ...(scope.userIds ? { userId: { in: [...scope.userIds] } } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, userId: true, secretEncrypted: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    for (const factor of factors) await visit(factor);
    cursor = factors.at(-1)?.id;
    if (factors.length < batchSize) return;
  }
}

function readable(secretEncrypted: string) {
  try {
    decryptMfaSecret(secretEncrypted);
    return true;
  } catch {
    return false;
  }
}

/** Read-only: counts rows by format and checks that each decrypts. */
export async function planMfaReencryption(db: Db, batchSize = DEFAULT_BATCH_SIZE, scope: MfaReencryptScope = {}) {
  const plan = { factors: 0, current: 0, legacy: 0, unreadable: 0 };
  await forEachFactor(db, batchSize, scope, (factor) => {
    plan.factors += 1;
    if (!readable(factor.secretEncrypted)) plan.unreadable += 1;
    else if (mfaSecretNeedsReencryption(factor.secretEncrypted)) plan.legacy += 1;
    else plan.current += 1;
  });
  return plan;
}

/**
 * Re-encrypts every readable legacy row. Unreadable rows are never written.
 * `changed` counts rows whose ciphertext changed underneath the run (a
 * concurrent sign-in or re-enrolment); rerunning picks up anything left.
 */
export async function reencryptMfaSecrets(db: Db, batchSize = DEFAULT_BATCH_SIZE, scope: MfaReencryptScope = {}) {
  const result = { reencrypted: 0, alreadyCurrent: 0, changed: 0, unreadable: 0 };
  await forEachFactor(db, batchSize, scope, async (factor) => {
    if (!mfaSecretNeedsReencryption(factor.secretEncrypted)) {
      result.alreadyCurrent += 1;
      return;
    }
    if (!readable(factor.secretEncrypted)) {
      result.unreadable += 1;
      return;
    }
    const outcome = await reencryptLegacyMfaSecret(db, factor);
    if (outcome === "reencrypted") result.reencrypted += 1;
    else if (outcome === "changed") result.changed += 1;
    else result.alreadyCurrent += 1;
  });
  return result;
}

export async function runMfaReencryption(db: Db, options: MfaReencryptOptions, env: Environment, scope: MfaReencryptScope = {}) {
  const plan = await planMfaReencryption(db, options.batchSize, scope);
  if (!options.execute) return { mode: "plan" as const, ...plan };
  if (env.MFA_REENCRYPT_CONFIRM !== EXECUTE_CONFIRMATION) throw new MfaReencryptRefusedError("confirmation-missing");
  if (plan.unreadable > 0 && !options.allowUnreadable) throw new MfaReencryptRefusedError("unreadable-rows");
  const result = await reencryptMfaSecrets(db, options.batchSize, scope);
  const after = await planMfaReencryption(db, options.batchSize, scope);
  return { mode: "execute" as const, ...result, remainingLegacy: after.legacy, remainingUnreadable: after.unreadable };
}

async function main() {
  let category = "unexpected";
  try {
    const options = parseMfaReencryptArguments(process.argv.slice(2));
    const { url, target } = resolveMfaReencryptTarget(process.env, options.target);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      category = "run";
      const outcome = await runMfaReencryption(db, options, process.env);
      console.log(JSON.stringify({ status: "ok", target, batchSize: options.batchSize, ...outcome, secretDetailsEmitted: false }));
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    if (error instanceof MfaReencryptRefusedError) category = error.category;
    console.error(JSON.stringify({ status: "failed", safeCategory: `mfa-reencrypt:${category}`, secretDetailsEmitted: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
