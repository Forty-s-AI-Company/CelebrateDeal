import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "./local-database-safety";

type ExpectedMigration = { name: string; checksums: string[] };
type AppliedMigration = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

/** Prisma accepts line-ending variants; preserve the same portability on Windows. */
export function readExpectedMigrations(directory: string): ExpectedMigration[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const sql = readFileSync(path.join(directory, entry.name, "migration.sql"), "utf8");
      const lf = sql.replace(/\r\n/g, "\n");
      return {
        name: entry.name,
        checksums: [sql, lf, lf.replace(/\n/g, "\r\n")]
          .map((content) => createHash("sha256").update(content).digest("hex")),
      };
    });
}

/** Return aggregate diagnostics only, never SQL, connection details or rows. */
export function compareLocalSchema(expected: ExpectedMigration[], applied: AppliedMigration[]) {
  const active = applied.filter((row) => !row.rolled_back_at);
  const completed = active.filter((row) => row.finished_at);
  const expectedNames = new Set(expected.map((row) => row.name));
  const missing = expected.filter((row) => !completed.some((item) => item.migration_name === row.name)).length;
  const changed = expected.filter((row) => completed.some((item) =>
    item.migration_name === row.name && !row.checksums.includes(item.checksum))).length;
  const unexpected = completed.filter((row) => !expectedNames.has(row.migration_name)).length;
  const unfinished = active.filter((row) => !row.finished_at).length;
  return { ok: expected.length > 0 && missing === 0 && changed === 0 && unexpected === 0 && unfinished === 0,
    expected: expected.length, missing, changed, unexpected, unfinished };
}

export async function assertLocalSchemaCurrent(databaseUrl: string | undefined, root = process.cwd()) {
  // Validate before creating the client; this command never inspects remote DBs.
  assertLocalTestDatabase("DATABASE_URL", databaseUrl);
  const expected = readExpectedMigrations(path.join(root, "prisma/migrations"));
  const db = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
  try {
    const rows = await db.$queryRaw<AppliedMigration[]>`
      SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"
    `;
    const result = compareLocalSchema(expected, rows);
    if (!result.ok) {
      throw new Error(`[local_database_schema] out-of-date ${JSON.stringify(result)}; prepare a fresh disposable DB from this revision before starting.`);
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[local_database_schema]")) throw error;
    throw new Error("[local_database_schema] unavailable or uninitialized; verify the isolated local DB and apply this revision to a fresh disposable DB.");
  } finally {
    await db.$disconnect();
  }
}
