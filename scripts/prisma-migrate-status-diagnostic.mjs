const PRISMA_ERROR_CATEGORY = Object.freeze({
  P1000: "connection-authentication",
  P1001: "database-unreachable",
  P1002: "database-timeout",
  P1003: "database-missing",
  P1008: "operation-timeout",
  P1010: "database-permission",
  P1011: "tls-configuration",
  P1012: "schema-configuration",
  P1013: "connection-configuration",
  P1017: "database-connection-closed",
  P3005: "migration-baseline-required",
  P3009: "failed-migrations",
  P3015: "migration-file-missing",
  P3018: "failed-migrations",
  P3019: "migration-provider-mismatch",
});

const SAFE_MIGRATION_NAME = /\b\d{14}_[a-z0-9_]+\b/gi;
const SAFE_MIGRATION_NAME_EXACT = /^\d{14}_[a-z0-9_]+$/i;

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function knownErrorCode(output) {
  for (const match of safeText(output).matchAll(/\bP\d{4}\b/g)) {
    const code = match[0];
    if (Object.hasOwn(PRISMA_ERROR_CATEGORY, code)) return code;
  }
  return null;
}

function explicitStatusCategory(output) {
  const text = safeText(output);

  if (/Database schema is up to date!/i.test(text)) return "up-to-date";
  if (/\b(?:has|have) not yet been applied\b|following migrations?\s+have not been applied/i.test(text)) {
    return "pending-migrations";
  }
  if (
    /local migration history and the migrations table from your database are different/i.test(text)
    || /migrations from the database are not found locally/i.test(text)
  ) {
    return "history-diverged";
  }
  if (/no migration table is found|migration table [`"]?_prisma_migrations[`"]? (?:was )?not found/i.test(text)) {
    return "migration-table-missing";
  }
  if (/failed migrations? (?:are )?found/i.test(text)) return "failed-migrations";

  return null;
}

function knownMigrationNameSet(knownMigrationNames) {
  if (!Array.isArray(knownMigrationNames)) return new Set();
  return new Set(knownMigrationNames.filter((name) => (
    typeof name === "string" && SAFE_MIGRATION_NAME_EXACT.test(name)
  )));
}

function pendingMigrations(output, category, knownMigrationNames) {
  if (category !== "pending-migrations" && category !== "history-diverged") return [];
  const allowedNames = knownMigrationNameSet(knownMigrationNames);
  return [...new Set(safeText(output).match(SAFE_MIGRATION_NAME) ?? [])]
    .filter((name) => allowedNames.has(name));
}

/**
 * Converts untrusted Prisma CLI output into a closed diagnostic receipt.
 *
 * The caller must keep the original stdout/stderr in memory. This function
 * intentionally returns only a fixed category, a whitelisted Prisma code, and
 * migration directory names that are already part of the repository history.
 */
export function classifyPrismaMigrateStatus(output, { knownMigrationNames = [] } = {}) {
  const errorCode = knownErrorCode(output);
  const category = errorCode
    ? PRISMA_ERROR_CATEGORY[errorCode]
    : explicitStatusCategory(output) ?? "unknown";

  return Object.freeze({
    category,
    errorCode,
    pendingMigrations: pendingMigrations(output, category, knownMigrationNames),
  });
}
