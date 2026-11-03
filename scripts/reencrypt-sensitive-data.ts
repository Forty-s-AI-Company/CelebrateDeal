/**
 * F-031 ②③: moves every sensitive-data envelope (and MFA secret) that is not
 * under the active DATA_ENCRYPTION_KEYRING kid onto it. The column list and
 * purposes live in scripts/sensitive-data-envelope-targets.ts; the rotation
 * procedure is docs/staging-production-env-vars.md §8.
 *
 * Safety (a guard against mistakes, not an access control):
 * - Dry run by default: decrypts every row in memory to count it by kid and
 *   prints counts only. Writing needs `--apply` AND
 *   DATA_REENCRYPT_CONFIRM=REENCRYPT_SENSITIVE_DATA.
 * - Target: a loopback `celebratedeal_*` database is always allowed. Staging
 *   needs `--target=staging` and a URL that is the staging database. Any other
 *   database needs `--target=production` AND
 *   DATA_REENCRYPT_PRODUCTION_APPROVAL=OWNER_APPROVED_PRODUCTION_DATA_REENCRYPT,
 *   set only with the owner's explicit approval. The validated URL is pinned
 *   into the Prisma client. Nothing reads `.env*`: the operator injects
 *   DATABASE_URL, CSRF_SECRET and DATA_ENCRYPTION_KEYRING.
 * - A row is written only after it decrypted under its own kid and purpose and
 *   the new envelope decrypts back to the same plaintext. Unreadable rows
 *   block `--apply` unless `--allow-unreadable`, and are never written.
 * - Each write is a compare-and-swap on the old ciphertext (raw SQL, so
 *   updatedAt does not move): idempotent, safe to interrupt and rerun, never
 *   overwrites a concurrent application write.
 * - Prints table names, row counts and kids only: never plaintext, ciphertext,
 *   keys, row IDs or bindings.
 *
 * Usage:
 *   DATABASE_URL=<staging> node --import tsx scripts/reencrypt-sensitive-data.ts --target=staging
 *   DATA_REENCRYPT_CONFIRM=REENCRYPT_SENSITIVE_DATA DATABASE_URL=<staging> \
 *     node --import tsx scripts/reencrypt-sensitive-data.ts --target=staging --apply
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";
import { decryptMfaSecret, mfaSecretKeyId, mfaSecretNeedsReencryption, reencryptMfaSecret } from "../src/lib/mfa";
import {
  DataEncryptionKeyringError,
  dataEncryptionKeyringSummary,
  decryptSensitiveValue,
  encryptSensitiveValue,
  sensitiveEnvelopeKeyId,
} from "../src/lib/sensitive-data";
import { classifyLocalTestDatabase } from "./local-database-safety";
import { ENVELOPE_TARGETS, envelopeTargetLabel, type EnvelopeRow, type EnvelopeTarget } from "./sensitive-data-envelope-targets";

export const APPLY_CONFIRMATION = "REENCRYPT_SENSITIVE_DATA";
export const PRODUCTION_APPROVAL = "OWNER_APPROVED_PRODUCTION_DATA_REENCRYPT";
const DEFAULT_BATCH_SIZE = 200;
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/u;

type Environment = Readonly<Record<string, string | undefined>>;
export type RawDb = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;
export type ReencryptLog = (entry: Record<string, unknown>) => void;

export class SensitiveDataReencryptRefusedError extends Error {
  constructor(public readonly category: string) {
    super("Sensitive data re-encryption refused.");
    this.name = "SensitiveDataReencryptRefusedError";
  }
}

export type ReencryptOptions = {
  apply: boolean;
  target: "loopback" | "staging" | "production" | null;
  batchSize: number;
  allowUnreadable: boolean;
  /** "Table.column" labels; null = every target. */
  only: string[] | null;
};

export function parseReencryptArguments(argv: readonly string[]): ReencryptOptions {
  const options: ReencryptOptions = { apply: false, target: null, batchSize: DEFAULT_BATCH_SIZE, allowUnreadable: false, only: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--apply") options.apply = true;
    else if (argument === "--allow-unreadable") options.allowUnreadable = true;
    else if (argument.startsWith("--target=")) {
      const target = argument.slice("--target=".length);
      if (target !== "loopback" && target !== "staging" && target !== "production") throw new SensitiveDataReencryptRefusedError("invalid-target");
      options.target = target;
    } else if (argument.startsWith("--only=")) {
      const label = argument.slice("--only=".length);
      if (!ENVELOPE_TARGETS.some((target) => envelopeTargetLabel(target) === label)) throw new SensitiveDataReencryptRefusedError("unknown-only");
      options.only = [...(options.only ?? []), label];
    } else if (argument === "--batch-size") {
      const value = Number(argv[index + 1]);
      if (!Number.isSafeInteger(value) || value < 1 || value > 1000) throw new SensitiveDataReencryptRefusedError("invalid-batch-size");
      options.batchSize = value;
      index += 1;
    } else {
      throw new SensitiveDataReencryptRefusedError("unknown-argument");
    }
  }
  return options;
}

/** Returns the database URL the tool may use, or throws a safe category. */
export function resolveReencryptTarget(env: Environment, target: ReencryptOptions["target"]) {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new SensitiveDataReencryptRefusedError("missing");
  if (classifyLocalTestDatabase(url).safe) {
    if (target !== null && target !== "loopback") throw new SensitiveDataReencryptRefusedError("target-mismatch");
    return { url, target: "loopback" as const };
  }
  if (target === "staging") {
    if (!isStagingDatabaseUrl(url)) throw new SensitiveDataReencryptRefusedError("not-staging");
    return { url, target: "staging" as const };
  }
  if (target === "production") {
    if (isStagingDatabaseUrl(url)) throw new SensitiveDataReencryptRefusedError("target-mismatch");
    if (env.DATA_REENCRYPT_PRODUCTION_APPROVAL !== PRODUCTION_APPROVAL) throw new SensitiveDataReencryptRefusedError("production-not-approved");
    return { url, target: "production" as const };
  }
  throw new SensitiveDataReencryptRefusedError("remote-without-target");
}

/** Tests (and a targeted manual run) may restrict the scan to given tenants or users. */
export type ReencryptScope = { vendorIds?: readonly string[]; userIds?: readonly string[] };

function quote(identifier: string) {
  if (!IDENTIFIER.test(identifier)) throw new Error("Unsafe identifier in envelope target.");
  return `"${identifier}"`;
}

function scopeValues(target: EnvelopeTarget, scope: ReencryptScope | undefined) {
  if (!scope) return undefined;
  return (target.scopeColumn === "vendorId" ? scope.vendorIds : scope.userIds) ?? [];
}

type StoredRow = { id: string; value: string; row: EnvelopeRow };

async function readBatch(db: RawDb, target: EnvelopeTarget, cursor: string | null, batchSize: number, scope: ReencryptScope | undefined) {
  const idColumn = target.idColumn ?? "id";
  const columns = [
    `t.${quote(idColumn)} AS "__id"`,
    `t.${quote(target.column)} AS "__value"`,
    ...target.fields.map((field) => `t.${quote(field)} AS ${quote(field)}`),
    ...(target.join?.fields ?? []).map((field) => `j.${quote(field)} AS "${target.join!.table}.${field}"`),
  ];
  const join = target.join ? ` LEFT JOIN ${quote(target.join.table)} j ON j."id" = t.${quote(target.join.localColumn)}` : "";
  const params: unknown[] = [batchSize];
  const conditions = [`t.${quote(target.column)} IS NOT NULL`];
  if (cursor !== null) {
    params.push(cursor);
    conditions.push(`t.${quote(idColumn)} > $${params.length}`);
  }
  const scoped = scopeValues(target, scope);
  if (scoped) {
    params.push([...scoped]);
    conditions.push(`t.${quote(target.scopeColumn)} = ANY($${params.length}::text[])`);
  }
  const sql = `SELECT ${columns.join(", ")} FROM ${quote(target.table)} t${join} WHERE ${conditions.join(" AND ")} ORDER BY t.${quote(idColumn)} ASC LIMIT $1`;
  const rows = await db.$queryRawUnsafe<Array<Record<string, string | number | null>>>(sql, ...params);
  return rows.map((raw): StoredRow => {
    const id = String(raw.__id);
    const row: Record<string, string | number | null> = { ...raw };
    delete row.__id;
    delete row.__value;
    if (idColumn === "id") row.id = id;
    return { id, value: String(raw.__value), row };
  });
}

async function* batches(db: RawDb, target: EnvelopeTarget, batchSize: number, scope: ReencryptScope | undefined) {
  let cursor: string | null = null;
  while (true) {
    const rows = await readBatch(db, target, cursor, batchSize, scope);
    if (rows.length > 0) yield rows;
    if (rows.length < batchSize) return;
    cursor = rows.at(-1)!.id;
  }
}

type Classified =
  | { kind: "unrecognized" }
  | { kind: "unreadable"; keyId: string }
  | { kind: "readable"; keyId: string; needsReencryption: boolean; purpose: string | null; plaintext: string };

function candidatePurposes(target: EnvelopeTarget, row: EnvelopeRow) {
  try {
    return target.purposes?.(row) ?? [];
  } catch {
    return [];
  }
}

function classify(target: EnvelopeTarget, stored: StoredRow, activeKeyId: string): Classified {
  if (target.codec === "mfa") {
    const keyId = mfaSecretKeyId(stored.value);
    if (keyId === null) return { kind: "unrecognized" };
    try {
      const plaintext = decryptMfaSecret(stored.value);
      return { kind: "readable", keyId, needsReencryption: mfaSecretNeedsReencryption(stored.value), purpose: null, plaintext };
    } catch {
      return { kind: "unreadable", keyId };
    }
  }
  const keyId = sensitiveEnvelopeKeyId(stored.value);
  if (keyId === null) return { kind: "unrecognized" };
  for (const purpose of candidatePurposes(target, stored.row)) {
    try {
      const plaintext = decryptSensitiveValue(stored.value, purpose);
      return { kind: "readable", keyId, needsReencryption: keyId !== activeKeyId, purpose, plaintext };
    } catch {
      // Wrong candidate, unknown kid or damaged envelope: try the next one.
    }
  }
  return { kind: "unreadable", keyId };
}

function reencrypted(target: EnvelopeTarget, value: string, classified: Extract<Classified, { kind: "readable" }>) {
  if (target.codec === "mfa") return reencryptMfaSecret(value);
  const next = encryptSensitiveValue(classified.plaintext, classified.purpose!);
  if (decryptSensitiveValue(next, classified.purpose!) !== classified.plaintext) throw new Error("Re-encryption check failed.");
  return next;
}

function nextKeyId(target: EnvelopeTarget, value: string) {
  return (target.codec === "mfa" ? mfaSecretKeyId(value) : sensitiveEnvelopeKeyId(value)) ?? "unrecognized";
}

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export type TargetPlan = {
  table: string;
  column: string;
  rows: number;
  byKeyId: Record<string, number>;
  pending: number;
  unreadable: number;
  unrecognized: number;
};

/** Read-only: counts rows by kid and checks that each one decrypts. */
export async function planTarget(db: RawDb, target: EnvelopeTarget, batchSize: number, scope?: ReencryptScope): Promise<TargetPlan> {
  const activeKeyId = dataEncryptionKeyringSummary().activeKeyId;
  const plan: TargetPlan = { table: target.table, column: target.column, rows: 0, byKeyId: {}, pending: 0, unreadable: 0, unrecognized: 0 };
  for await (const rows of batches(db, target, batchSize, scope)) {
    for (const stored of rows) {
      plan.rows += 1;
      const classified = classify(target, stored, activeKeyId);
      if (classified.kind === "unrecognized") {
        plan.unrecognized += 1;
        continue;
      }
      increment(plan.byKeyId, classified.keyId);
      if (classified.kind === "unreadable") plan.unreadable += 1;
      else if (classified.needsReencryption) plan.pending += 1;
    }
  }
  return plan;
}

export type TargetResult = { table: string; column: string; reencrypted: number; alreadyActive: number; changed: number; unreadable: number; unrecognized: number };

/**
 * Re-encrypts every readable row whose kid is not active, batch by batch.
 * `changed` counts rows that changed underneath the run (a concurrent write);
 * rerunning picks up anything left.
 */
export async function reencryptTarget(
  db: RawDb,
  target: EnvelopeTarget,
  batchSize: number,
  log: ReencryptLog,
  scope?: ReencryptScope,
): Promise<TargetResult> {
  const activeKeyId = dataEncryptionKeyringSummary().activeKeyId;
  const idColumn = quote(target.idColumn ?? "id");
  const column = quote(target.column);
  const update = `UPDATE ${quote(target.table)} SET ${column} = $1 WHERE ${idColumn} = $2 AND ${column} = $3`;
  const result: TargetResult = { table: target.table, column: target.column, reencrypted: 0, alreadyActive: 0, changed: 0, unreadable: 0, unrecognized: 0 };
  let batch = 0;
  for await (const rows of batches(db, target, batchSize, scope)) {
    batch += 1;
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    const counts = { reencrypted: 0, changed: 0, unreadable: 0, unrecognized: 0 };
    for (const stored of rows) {
      const classified = classify(target, stored, activeKeyId);
      if (classified.kind === "unrecognized") {
        counts.unrecognized += 1;
        increment(before, "unrecognized");
        increment(after, "unrecognized");
        continue;
      }
      increment(before, classified.keyId);
      if (classified.kind === "unreadable") {
        counts.unreadable += 1;
        increment(after, classified.keyId);
        continue;
      }
      if (!classified.needsReencryption) {
        result.alreadyActive += 1;
        increment(after, classified.keyId);
        continue;
      }
      const next = reencrypted(target, stored.value, classified);
      const written = await db.$executeRawUnsafe(update, next, stored.id, stored.value);
      if (written === 1) {
        counts.reencrypted += 1;
        increment(after, nextKeyId(target, next));
      } else {
        counts.changed += 1;
        increment(after, "changed");
      }
    }
    result.reencrypted += counts.reencrypted;
    result.changed += counts.changed;
    result.unreadable += counts.unreadable;
    result.unrecognized += counts.unrecognized;
    log({ event: "batch", table: target.table, column: target.column, batch, rows: rows.length, before, after, ...counts });
  }
  return result;
}

export async function runSensitiveDataReencryption(
  db: RawDb,
  options: ReencryptOptions,
  env: Environment,
  input: { scope?: ReencryptScope; targets?: readonly EnvelopeTarget[]; log?: ReencryptLog } = {},
) {
  const log = input.log ?? (() => undefined);
  let keyring;
  try {
    keyring = dataEncryptionKeyringSummary();
  } catch (error) {
    if (error instanceof DataEncryptionKeyringError) throw new SensitiveDataReencryptRefusedError(`keyring-${error.issue}`);
    throw error;
  }
  const targets = (input.targets ?? ENVELOPE_TARGETS)
    .filter((target) => options.only === null || options.only.includes(envelopeTargetLabel(target)));
  log({ event: "start", mode: options.apply ? "apply" : "plan", activeKeyId: keyring.activeKeyId, acceptedKeyIds: keyring.keyIds });

  const plans: TargetPlan[] = [];
  for (const target of targets) {
    const plan = await planTarget(db, target, options.batchSize, input.scope);
    plans.push(plan);
    log({ event: "plan", ...plan });
  }
  const totals = (list: TargetPlan[]) => ({
    rows: list.reduce((sum, plan) => sum + plan.rows, 0),
    pending: list.reduce((sum, plan) => sum + plan.pending, 0),
    unreadable: list.reduce((sum, plan) => sum + plan.unreadable, 0),
    unrecognized: list.reduce((sum, plan) => sum + plan.unrecognized, 0),
  });
  if (!options.apply) return { mode: "plan" as const, activeKeyId: keyring.activeKeyId, ...totals(plans), targets: plans };

  if (env.DATA_REENCRYPT_CONFIRM !== APPLY_CONFIRMATION) throw new SensitiveDataReencryptRefusedError("confirmation-missing");
  if (totals(plans).unreadable > 0 && !options.allowUnreadable) throw new SensitiveDataReencryptRefusedError("unreadable-rows");

  const results: TargetResult[] = [];
  for (const target of targets) results.push(await reencryptTarget(db, target, options.batchSize, log, input.scope));
  const after: TargetPlan[] = [];
  for (const target of targets) after.push(await planTarget(db, target, options.batchSize, input.scope));
  const remaining = totals(after);
  return {
    mode: "apply" as const,
    activeKeyId: keyring.activeKeyId,
    reencrypted: results.reduce((sum, result) => sum + result.reencrypted, 0),
    changed: results.reduce((sum, result) => sum + result.changed, 0),
    remainingPending: remaining.pending,
    remainingUnreadable: remaining.unreadable,
    targets: after,
  };
}

async function main() {
  let category = "unexpected";
  const log: ReencryptLog = (entry) => console.log(JSON.stringify(entry));
  try {
    const options = parseReencryptArguments(process.argv.slice(2));
    const { url, target } = resolveReencryptTarget(process.env, options.target);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      category = "run";
      const outcome = await runSensitiveDataReencryption(db, options, process.env, { log });
      const { targets: _perTarget, ...summary } = outcome;
      void _perTarget;
      log({ event: "done", status: "ok", target, batchSize: options.batchSize, ...summary, secretDetailsEmitted: false });
    } finally {
      await db.$disconnect();
    }
  } catch (error) {
    if (error instanceof SensitiveDataReencryptRefusedError) category = error.category;
    console.error(JSON.stringify({ event: "done", status: "failed", safeCategory: `data-reencrypt:${category}`, secretDetailsEmitted: false }));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
