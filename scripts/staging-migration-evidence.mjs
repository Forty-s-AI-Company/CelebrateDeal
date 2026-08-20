import { createHash } from "node:crypto";

export const STAGING_MIGRATION_RECEIPT_SCHEMA = "celebratedeal-staging-migration-evidence/v1";

const SAFE_MIGRATION_NAME = /^\d{12,14}_[a-z0-9_]+$/iu;
const SAFE_OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const SAFE_DIGEST = /^[a-f0-9]{64}$/u;
const ALLOWED_ENVIRONMENTS = new Set(["staging", "isolated-restore-drill"]);
const ALLOWED_DATABASE_IDENTITIES = new Set(["staging-database", "isolated-restore-target"]);
const ALLOWED_STATUSES = new Set([
  "up-to-date",
  "pending-migrations",
  "history-diverged",
  "migration-table-missing",
  "failed-migrations",
  "connection-error",
  "unknown",
]);

const RECEIPT_KEYS = [
  "schemaVersion",
  "workPackage",
  "result",
  "runId",
  "executedAtUtc",
  "authorizationRecordRef",
  "environmentClass",
  "databaseIdentityClass",
  "migrationStatus",
  "expectedMigrationCount",
  "appliedMigrationCount",
  "expectedMigrationDigest",
  "appliedMigrationDigest",
  "unallowlistedMigrationCount",
  "safety",
  "sideEffects",
];

const SAFETY_KEYS = [
  "sanitized",
  "rawOutputPersisted",
  "credentialsPersisted",
  "tokensPersisted",
  "cookiesPersisted",
  "customerDataPersisted",
];

const SIDE_EFFECT_KEYS = [
  "databaseReads",
  "databaseWrites",
  "migrationWrites",
  "productionOperations",
  "deploymentOperations",
];

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function opaqueReference(value) {
  return typeof value === "string" && SAFE_OPAQUE_REFERENCE.test(value) ? value : "unknown";
}

function environmentClass(value) {
  return ALLOWED_ENVIRONMENTS.has(value) ? value : "unknown";
}

function databaseIdentityClass(value) {
  return ALLOWED_DATABASE_IDENTITIES.has(value) ? value : "unknown";
}

function canonicalNames(value) {
  if (!Array.isArray(value)) return { names: [], invalidCount: 1 };
  const names = [];
  let invalidCount = 0;
  for (const item of value) {
    if (typeof item !== "string" || !SAFE_MIGRATION_NAME.test(item)) {
      invalidCount += 1;
      continue;
    }
    if (!names.includes(item)) names.push(item);
  }
  return { names: names.sort((left, right) => left.localeCompare(right)), invalidCount };
}

function appliedNames(value, knownNames) {
  if (!Array.isArray(value)) return { names: [], unallowlistedCount: 1 };
  const known = new Set(knownNames);
  const names = [];
  let unallowlistedCount = 0;
  for (const item of value) {
    if (typeof item !== "string" || !SAFE_MIGRATION_NAME.test(item) || !known.has(item)) {
      unallowlistedCount += 1;
      continue;
    }
    if (!names.includes(item)) names.push(item);
  }
  return { names: names.sort((left, right) => left.localeCompare(right)), unallowlistedCount };
}

function digestNames(names) {
  return createHash("sha256").update(names.join("\n")).digest("hex");
}

function safeUtc(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return "unknown";
  return Number.isNaN(Date.parse(value)) ? "unknown" : value;
}

function inferredResult({ authorizationRecordRef, environment, databaseIdentity, status, expected, applied, invalidExpectedCount, unallowlistedCount }) {
  const pass = authorizationRecordRef !== "unknown"
    && environment === "staging"
    && databaseIdentity === "staging-database"
    && status === "up-to-date"
    && invalidExpectedCount === 0
    && unallowlistedCount === 0
    && expected.length > 0
    && expected.length === applied.length
    && digestNames(expected) === digestNames(applied);
  if (pass) return "PASS";
  if (["pending-migrations", "history-diverged", "migration-table-missing", "failed-migrations"].includes(status)) return "FAILED";
  return "BLOCKED";
}

/**
 * Builds a value-free receipt from already-sanitized migration facts.
 * Raw Prisma stdout/stderr must stay in memory and must never be passed here.
 */
export function createStagingMigrationReceipt({
  runId,
  executedAtUtc,
  authorizationRecordRef,
  environmentClass: rawEnvironmentClass,
  databaseIdentityClass: rawDatabaseIdentityClass,
  migrationStatus: rawMigrationStatus,
  expectedMigrationNames,
  appliedMigrationNames,
} = {}) {
  const expected = canonicalNames(expectedMigrationNames);
  const applied = appliedNames(appliedMigrationNames, expected.names);
  const environment = environmentClass(rawEnvironmentClass);
  const databaseIdentity = databaseIdentityClass(rawDatabaseIdentityClass);
  const status = ALLOWED_STATUSES.has(rawMigrationStatus) ? rawMigrationStatus : "unknown";
  const authRef = opaqueReference(authorizationRecordRef);

  return Object.freeze({
    schemaVersion: STAGING_MIGRATION_RECEIPT_SCHEMA,
    workPackage: "STAGING_MIGRATION_EVIDENCE",
    result: inferredResult({
      authorizationRecordRef: authRef,
      environment,
      databaseIdentity,
      status,
      expected: expected.names,
      applied: applied.names,
      invalidExpectedCount: expected.invalidCount,
      unallowlistedCount: applied.unallowlistedCount,
    }),
    runId: opaqueReference(runId),
    executedAtUtc: safeUtc(executedAtUtc),
    authorizationRecordRef: authRef,
    environmentClass: environment,
    databaseIdentityClass: databaseIdentity,
    migrationStatus: status,
    expectedMigrationCount: expected.names.length,
    appliedMigrationCount: applied.names.length,
    expectedMigrationDigest: digestNames(expected.names),
    appliedMigrationDigest: digestNames(applied.names),
    unallowlistedMigrationCount: expected.invalidCount + applied.unallowlistedCount,
    safety: {
      sanitized: true,
      rawOutputPersisted: false,
      credentialsPersisted: false,
      tokensPersisted: false,
      cookiesPersisted: false,
      customerDataPersisted: false,
    },
    sideEffects: {
      databaseReads: 0,
      databaseWrites: 0,
      migrationWrites: 0,
      productionOperations: 0,
      deploymentOperations: 0,
    },
  });
}

export function validateStagingMigrationReceipt(value) {
  if (!exactKeys(value, RECEIPT_KEYS)) return false;
  if (value.schemaVersion !== STAGING_MIGRATION_RECEIPT_SCHEMA || value.workPackage !== "STAGING_MIGRATION_EVIDENCE") return false;
  if (!["PASS", "FAILED", "BLOCKED"].includes(value.result)) return false;
  if (!SAFE_OPAQUE_REFERENCE.test(value.runId) && value.runId !== "unknown") return false;
  if (!SAFE_OPAQUE_REFERENCE.test(value.authorizationRecordRef) && value.authorizationRecordRef !== "unknown") return false;
  if (value.executedAtUtc !== "unknown" && safeUtc(value.executedAtUtc) !== value.executedAtUtc) return false;
  if (![...ALLOWED_ENVIRONMENTS, "unknown"].includes(value.environmentClass)) return false;
  if (![...ALLOWED_DATABASE_IDENTITIES, "unknown"].includes(value.databaseIdentityClass)) return false;
  if (!ALLOWED_STATUSES.has(value.migrationStatus)) return false;
  if (!["expectedMigrationCount", "appliedMigrationCount", "unallowlistedMigrationCount"].every((key) => Number.isInteger(value[key]) && value[key] >= 0)) return false;
  if (!SAFE_DIGEST.test(value.expectedMigrationDigest) || !SAFE_DIGEST.test(value.appliedMigrationDigest)) return false;
  if (!exactKeys(value.safety, SAFETY_KEYS) || Object.values(value.safety).some((item) => item !== false && item !== true)) return false;
  if (!exactKeys(value.sideEffects, SIDE_EFFECT_KEYS) || Object.values(value.sideEffects).some((item) => !Number.isInteger(item) || item < 0)) return false;
  if (value.safety.sanitized !== true || value.safety.rawOutputPersisted !== false || value.safety.credentialsPersisted !== false || value.safety.tokensPersisted !== false || value.safety.cookiesPersisted !== false || value.safety.customerDataPersisted !== false) return false;
  if (value.sideEffects.databaseWrites !== 0 || value.sideEffects.migrationWrites !== 0 || value.sideEffects.productionOperations !== 0 || value.sideEffects.deploymentOperations !== 0) return false;
  const serialized = JSON.stringify(value);
  if (/(?:postgres(?:ql)?:\/\/|Bearer\s+|BEGIN\s+(?:RSA|OPENSSH|EC)\s+PRIVATE\s+KEY)/iu.test(serialized)) return false;

  if (value.result === "PASS") {
    return value.runId !== "unknown"
      && value.executedAtUtc !== "unknown"
      && value.authorizationRecordRef !== "unknown"
      && value.environmentClass === "staging"
      && value.databaseIdentityClass === "staging-database"
      && value.migrationStatus === "up-to-date"
      && value.expectedMigrationCount > 0
      && value.expectedMigrationCount === value.appliedMigrationCount
      && value.unallowlistedMigrationCount === 0
      && value.expectedMigrationDigest === value.appliedMigrationDigest;
  }

  return true;
}
