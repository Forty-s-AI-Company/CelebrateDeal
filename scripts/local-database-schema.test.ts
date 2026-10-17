import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalSchemaCurrent, compareLocalSchema, readExpectedMigrations } from "./local-database-schema";

const mocked = vi.hoisted(() => ({ construct: vi.fn(), query: vi.fn(), disconnect: vi.fn() }));
vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor(options: unknown) { mocked.construct(options); }
    $queryRaw = mocked.query;
    $disconnect = mocked.disconnect;
  },
}));
afterEach(() => vi.resetAllMocks());

const expected = [{ name: "initial", checksums: ["lf", "crlf"] }];
const applied = { migration_name: "initial", checksum: "lf", finished_at: new Date(0), rolled_back_at: null };

describe("local database schema preflight", () => {
  it("rejects a remote target before constructing a database client", async () => {
    await expect(assertLocalSchemaCurrent("postgresql://remote.invalid/celebratedeal_test"))
      .rejects.toThrow("category=non-loopback");
    expect(mocked.construct).not.toHaveBeenCalled();
    expect(mocked.query).not.toHaveBeenCalled();
  });
  it("sanitizes driver errors and disconnects the local client", async () => {
    mocked.query.mockRejectedValue(new Error("connection failed: postgresql://private-host/internal"));
    const failure = await assertLocalSchemaCurrent("postgresql://localhost/celebratedeal_test")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("[local_database_schema] unavailable or uninitialized; verify the isolated local DB and apply this revision to a fresh disposable DB.");
    expect((failure as Error).message).not.toContain("private-host");
    expect(mocked.disconnect).toHaveBeenCalledOnce();
  });
  it("hashes actual CRLF and LF source variants", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "celebratedeal-schema-unit-"));
    const migration = path.join(directory, "initial");
    mkdirSync(migration);
    const file = path.join(migration, "migration.sql");
    try {
      writeFileSync(file, "SELECT 1;\r\n");
      const rows = readExpectedMigrations(directory);
      expect(rows).toHaveLength(1);
      for (const sql of ["SELECT 1;\n", "SELECT 1;\r\n"]) {
        expect(rows[0].checksums).toContain(createHash("sha256").update(sql).digest("hex"));
      }
    } finally {
      // Remove only files created by this test; no recursive directory cleanup.
      unlinkSync(file);
      rmdirSync(migration);
      rmdirSync(directory);
    }
  });
  it("accepts fully applied migrations with either line ending", () => {
    expect(compareLocalSchema(expected, [applied]).ok).toBe(true);
    expect(compareLocalSchema(expected, [{ ...applied, checksum: "crlf" }]).ok).toBe(true);
  });
  it("rejects missing, modified, unfinished and foreign-revision migrations", () => {
    expect(compareLocalSchema(expected, []).missing).toBe(1);
    expect(compareLocalSchema(expected, [{ ...applied, checksum: "other" }]).changed).toBe(1);
    expect(compareLocalSchema(expected, [{ ...applied, finished_at: null }]).unfinished).toBe(1);
    expect(compareLocalSchema(expected, [applied, { ...applied, migration_name: "future" }]).unexpected).toBe(1);
    for (const rows of [[], [{ ...applied, checksum: "other" }], [{ ...applied, finished_at: null }], [applied, { ...applied, migration_name: "future" }]]) {
      expect(compareLocalSchema(expected, rows).ok).toBe(false);
    }
  });
  it("ignores rolled-back attempts but still requires a successful replacement", () => {
    const rolledBack = { ...applied, finished_at: null, rolled_back_at: new Date(1) };
    expect(compareLocalSchema(expected, [rolledBack]).ok).toBe(false);
    expect(compareLocalSchema(expected, [rolledBack, applied]).ok).toBe(true);
  });
  it("does not certify an empty source inventory", () => {
    expect(compareLocalSchema([], []).ok).toBe(false);
  });
});
