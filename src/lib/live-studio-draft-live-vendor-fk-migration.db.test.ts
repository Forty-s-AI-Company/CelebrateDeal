import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * A3-02 migrations on the disposable PostgreSQL database built by
 * `prisma migrate deploy`: 20261119150000_live_studio_draft_live_vendor_fk adds
 * the composite (vendorId, liveId) -> Live(vendorId, id) foreign key NOT VALID;
 * 20261119150100_live_studio_draft_live_vendor_fk_validate refuses existing
 * cross-vendor drafts, validates the key and drops the single-column key.
 *
 * The replay tests run the statements of both files, read from the files
 * themselves, inside a transaction that is rolled back.
 */
const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const ADD = readFileSync(path.join(MIGRATIONS, "20261119150000_live_studio_draft_live_vendor_fk/migration.sql"), "utf8");
const VALIDATE = readFileSync(path.join(MIGRATIONS, "20261119150100_live_studio_draft_live_vendor_fk_validate/migration.sql"), "utf8");
const ORIGINAL = readFileSync(path.join(MIGRATIONS, "20260808094500_g7_03_live_studio_drafts/migration.sql"), "utf8");
/** DO blocks and ALTER TABLE statements, in file order. */
const statementsOf = (sql: string) => sql.match(/^(?:DO \$\$[\s\S]*?^\$\$|ALTER TABLE [^;]+);$/gmu) ?? [];
const ADD_STATEMENTS = statementsOf(ADD);
const VALIDATE_STATEMENTS = statementsOf(VALIDATE);
/** The single-column key as the original Live Studio migration wrote it. */
const ORIGINAL_LIVE_FK = (ORIGINAL.match(/^ALTER TABLE "LiveStudioDraft" ADD CONSTRAINT "LiveStudioDraft_liveId_fkey"[^;]+;$/mu) ?? [""])[0];
const FK = "LiveStudioDraft_vendorId_liveId_fkey";
const OLD_FK = "LiveStudioDraft_liveId_fkey";
const FK_DEFINITION = `FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", id) ON UPDATE CASCADE ON DELETE SET NULL ("liveId")`;

const db = getDb();
const vendorIds: string[] = [];

afterEach(async () => {
  // Vendor deletion cascades to its lives and drafts.
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

async function currentSchema(client: Pick<Prisma.TransactionClient, "$queryRaw"> = db) {
  const [row] = await client.$queryRaw<Array<{ schema: string }>>`SELECT pg_catalog.current_schema() AS schema`;
  return row!.schema;
}

/** Every foreign key from LiveStudioDraft to Live. */
async function liveForeignKeys(client: Pick<Prisma.TransactionClient, "$queryRaw"> = db) {
  const schema = await currentSchema(client);
  return client.$queryRaw<Array<{ name: string; definition: string; validated: boolean }>>`
    SELECT c.conname AS name, pg_catalog.pg_get_constraintdef(c.oid) AS definition, c.convalidated AS validated
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_class r ON r.oid = c.confrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = ${schema} AND t.relname = 'LiveStudioDraft' AND r.relname = 'Live' AND c.contype = 'f'
     ORDER BY c.conname
  `;
}

async function vendorWithLive(label: string) {
  const key = randomUUID().slice(0, 12);
  const vendor = await db.vendor.create({ data: { name: `A3-02 ${label}`, slug: `a3-02-draft-${key}`, email: `a3-02-${key}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(vendor.id);
  const live = await db.live.create({ data: { vendorId: vendor.id, title: `合成直播 ${label}`, slug: `a3-02-live-${key}`, scheduledAt: new Date("2030-01-01T00:00:00.000Z") } });
  return { vendor, live };
}

const draftData = (vendorId: string, liveId: string | null) => ({
  vendorId,
  liveId,
  payload: { title: "合成草稿", activeStep: 1 },
  updatedByMemberId: "synthetic-member",
  expiresAt: new Date(Date.now() + 60_000),
});

class Rollback extends Error {}

async function rolledBack(work: (tx: Prisma.TransactionClient) => Promise<void>) {
  await expect(db.$transaction(async (tx) => {
    await work(tx);
    throw new Rollback("rollback");
  }, { timeout: 60_000, maxWait: 10_000 })).rejects.toBeInstanceOf(Rollback);
}

/** Puts LiveStudioDraft back to the state before A3-02: only the single-column key. */
async function beforeA302(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`ALTER TABLE "LiveStudioDraft" DROP CONSTRAINT "${FK}"`);
  await tx.$executeRawUnsafe(ORIGINAL_LIVE_FK);
}

describe("A3-02 LiveStudioDraft (vendorId, liveId) -> Live(vendorId, id)", () => {
  it("reads both migrations: the key NOT VALID first; then check, validate and drop the old key last", () => {
    expect(ORIGINAL_LIVE_FK).toContain(`"${OLD_FK}"`);
    expect(ADD_STATEMENTS).toHaveLength(2);
    expect(ADD_STATEMENTS[0]).toContain("pg_catalog.set_config('lock_timeout', '5s', true)");
    // Review MAJOR-1: the PostgreSQL 15+ syntax runs through EXECUTE behind a version check.
    expect(ADD_STATEMENTS[1]).toContain("current_setting('server_version_num')::integer");
    expect(ADD_STATEMENTS[1]).toMatch(/IF server_version < 150000 THEN\s+RAISE EXCEPTION 'A3-02 needs PostgreSQL 15\+/u);
    expect(ADD_STATEMENTS[1]).toContain(
      `EXECUTE 'ALTER TABLE "LiveStudioDraft" ADD CONSTRAINT "${FK}" FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id") ON DELETE SET NULL ("liveId") ON UPDATE CASCADE NOT VALID';`,
    );
    // The guard comes before the ALTER, so an old server changes nothing.
    expect(ADD_STATEMENTS[1]!.indexOf("RAISE EXCEPTION")).toBeLessThan(ADD_STATEMENTS[1]!.indexOf("EXECUTE"));
    expect(VALIDATE_STATEMENTS).toHaveLength(4);
    expect(VALIDATE_STATEMENTS[0]).toContain("pg_catalog.set_config('lock_timeout', '5s', true)");
    expect(VALIDATE_STATEMENTS[1]).toContain("RAISE EXCEPTION");
    expect(VALIDATE_STATEMENTS.slice(2)).toEqual([
      `ALTER TABLE "LiveStudioDraft" VALIDATE CONSTRAINT "${FK}";`,
      `ALTER TABLE "LiveStudioDraft" DROP CONSTRAINT "${OLD_FK}";`,
    ]);
    // No row is rewritten by either file.
    const code = (sql: string) => sql.replace(/^\s*--.*$/gmu, "");
    for (const sql of [ADD, VALIDATE]) expect(code(sql)).not.toMatch(/^\s*(UPDATE|DELETE|INSERT)\b/mu);
  });

  it("stops the first file with a readable message on a server below the required version, adding nothing", async () => {
    // This server is 15+; raising the threshold in the guard plays an older server.
    const tooNew = ADD_STATEMENTS[1]!.replace("server_version < 150000", "server_version < 99990000");
    expect(tooNew).not.toBe(ADD_STATEMENTS[1]);
    await rolledBack(async (tx) => {
      await beforeA302(tx);
      await tx.$executeRawUnsafe(ADD_STATEMENTS[0]!);
      await tx.$executeRawUnsafe("SAVEPOINT version_guard");
      await expect(tx.$executeRawUnsafe(tooNew)).rejects.toThrow(/A3-02 needs PostgreSQL 15\+ for ON DELETE SET NULL \("liveId"\); this server is \d+/u);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT version_guard");
      await expect(liveForeignKeys(tx)).resolves.toEqual([expect.objectContaining({ name: OLD_FK, validated: true })]);
    });
  });

  it("leaves exactly one validated key from LiveStudioDraft to Live, the composite one", async () => {
    await expect(liveForeignKeys()).resolves.toEqual([{ name: FK, validated: true, definition: FK_DEFINITION }]);
  });

  it("refuses a draft of one vendor that names another vendor's live, on create and on update", async () => {
    const a = await vendorWithLive("A");
    const b = await vendorWithLive("B");

    await expect(db.liveStudioDraft.create({ data: draftData(a.vendor.id, b.live.id) })).rejects.toMatchObject({ code: "P2003" });

    const own = await db.liveStudioDraft.create({ data: draftData(a.vendor.id, a.live.id) });
    await expect(db.liveStudioDraft.update({ where: { id: own.id }, data: { liveId: b.live.id } })).rejects.toMatchObject({ code: "P2003" });
    // Moving the draft to the other vendor while it keeps its live is refused too.
    await expect(db.liveStudioDraft.update({ where: { id: own.id }, data: { vendorId: b.vendor.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.liveStudioDraft.findUniqueOrThrow({ where: { id: own.id } })).resolves.toMatchObject({ vendorId: a.vendor.id, liveId: a.live.id });

    expect(await db.liveStudioDraft.count({ where: { vendorId: b.vendor.id } })).toBe(0);
    expect(await db.liveStudioDraft.count({ where: { liveId: b.live.id } })).toBe(0);
  });

  it("keeps the draft and its vendor when its live is deleted, clearing only liveId", async () => {
    const a = await vendorWithLive("A");
    const draft = await db.liveStudioDraft.create({ data: draftData(a.vendor.id, a.live.id) });
    const unbound = await db.liveStudioDraft.create({ data: draftData(a.vendor.id, null) });

    await db.live.delete({ where: { id: a.live.id } });

    await expect(db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).resolves.toMatchObject({ vendorId: a.vendor.id, liveId: null });
    await expect(db.liveStudioDraft.findUniqueOrThrow({ where: { id: unbound.id } })).resolves.toMatchObject({ vendorId: a.vendor.id, liveId: null });
  });

  it("replays both files over existing own and unbound drafts, which keep every value", async () => {
    const a = await vendorWithLive("A");
    const own = await db.liveStudioDraft.create({ data: draftData(a.vendor.id, a.live.id) });
    const unbound = await db.liveStudioDraft.create({ data: draftData(a.vendor.id, null) });
    const ids = [own.id, unbound.id].sort();
    const rows = (tx: Prisma.TransactionClient) => tx.$queryRaw<Array<{ row: unknown }>>`
      SELECT to_jsonb(d) AS row FROM "LiveStudioDraft" d WHERE d."id" = ANY(${ids}::text[]) ORDER BY d."id"
    `;

    await rolledBack(async (tx) => {
      await beforeA302(tx);
      await expect(liveForeignKeys(tx)).resolves.toEqual([expect.objectContaining({ name: OLD_FK, validated: true })]);
      const before = await rows(tx);
      for (const statement of ADD_STATEMENTS) await tx.$executeRawUnsafe(statement);
      for (const statement of VALIDATE_STATEMENTS) await tx.$executeRawUnsafe(statement);
      await expect(liveForeignKeys(tx)).resolves.toEqual([{ name: FK, validated: true, definition: FK_DEFINITION }]);
      await expect(rows(tx)).resolves.toEqual(before);
    });
  });

  it("stops the validation file on an existing cross-vendor draft, leaving both keys and the new one NOT VALID", async () => {
    const a = await vendorWithLive("A");
    const b = await vendorWithLive("B");

    await rolledBack(async (tx) => {
      await beforeA302(tx);
      // Possible only before A3-02: vendor A's draft naming vendor B's live.
      const crossId = `a3_02_cross_${randomUUID().slice(0, 12)}`;
      await tx.$executeRaw`
        INSERT INTO "LiveStudioDraft" ("id", "vendorId", "liveId", "payload", "updatedByMemberId", "expiresAt", "updatedAt")
        VALUES (${crossId}, ${a.vendor.id}, ${b.live.id}, '{}'::jsonb, 'synthetic-member', now() + interval '1 minute', now())
      `;
      for (const statement of ADD_STATEMENTS) await tx.$executeRawUnsafe(statement);

      // Between the two files the new key already checks every new write.
      await tx.$executeRawUnsafe("SAVEPOINT between_files");
      await expect(tx.$executeRaw`
        INSERT INTO "LiveStudioDraft" ("id", "vendorId", "liveId", "payload", "updatedByMemberId", "expiresAt", "updatedAt")
        VALUES (${`${crossId}_new`}, ${b.vendor.id}, ${a.live.id}, '{}'::jsonb, 'synthetic-member', now() + interval '1 minute', now())
      `).rejects.toThrow(new RegExp(FK, "u"));
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT between_files");

      await tx.$executeRawUnsafe("SAVEPOINT before_validate");
      let failure: unknown;
      try {
        for (const statement of VALIDATE_STATEMENTS) await tx.$executeRawUnsafe(statement);
      } catch (error) {
        failure = error;
      }
      expect(String(failure)).toMatch(/A3-02: 1 LiveStudioDraft row\(s\) name a live of another vendor/u);
      // The message carries a count only, never an id.
      expect(String(failure)).not.toContain(crossId);
      expect(String(failure)).not.toContain(b.live.id);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT before_validate");
      await expect(liveForeignKeys(tx)).resolves.toEqual([
        expect.objectContaining({ name: OLD_FK, validated: true }),
        expect.objectContaining({ name: FK, validated: false }),
      ]);

      // Once the row is resolved, the file goes through.
      await tx.$executeRaw`DELETE FROM "LiveStudioDraft" WHERE "id" = ${crossId}`;
      for (const statement of VALIDATE_STATEMENTS) await tx.$executeRawUnsafe(statement);
      await expect(liveForeignKeys(tx)).resolves.toEqual([{ name: FK, validated: true, definition: FK_DEFINITION }]);
    });
  });
});
