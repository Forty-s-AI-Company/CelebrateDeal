import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { installMerchantSchema, merchantStatements, merchantPostProbeCompatible, MERCHANT_MIGRATION } from "./q1-merchant-schema";
import { Q1_DOWNSTREAM_MODELS, Q1DownstreamReceipt } from "../src/lib/q1-downstream-readonly";
const sql = await readFile(`prisma/migrations/${MERCHANT_MIGRATION}/migration.sql`, "utf8");
function client(before: { tables?: number; columns?: number; ledger?: unknown[] } = {}) {
  const query = vi.fn().mockResolvedValueOnce(Array.from({ length: before.tables ?? 0 }, () => ({ name: "existing" })))
    .mockResolvedValueOnce(Array.from({ length: before.columns ?? 0 }, () => ({ name: "existing" })))
    .mockResolvedValueOnce(before.ledger ?? [])
    .mockResolvedValueOnce(Array.from({ length: 7 }, () => ({ name: "created" })))
    .mockResolvedValueOnce(Array.from({ length: 4 }, () => ({ name: "created" }))).mockResolvedValueOnce([]);
  const execute = vi.fn().mockResolvedValue(0), raw = vi.fn().mockResolvedValue(0);
  return { query, execute, raw, tx: { $queryRaw: query, $executeRaw: execute, $executeRawUnsafe: raw } as unknown as Prisma.TransactionClient };
}
describe("fixed forward merchant schema", () => {
  it("rejects failed, empty, duplicate and incomplete post-migration reads", () => {
    const enums = [...new Set(Prisma.dmmf.datamodel.models.filter(model => (Q1_DOWNSTREAM_MODELS as readonly string[]).includes(model.name))
      .flatMap(model => model.fields.filter(field => field.kind === "enum").map(field => field.type)))];
    const full = Q1DownstreamReceipt.parse({ classification: "DOWNSTREAM_OBSERVED", readStage: "NONE", readClass: "NONE",
      schema: Q1_DOWNSTREAM_MODELS.map(model => ({ model, compatible: true, missingColumns: [] })),
      enums: enums.map(name => ({ name, compatible: true, missingLabels: [] })), decrypt: "OK", protect: "OK", billingPurposeClass: "buyer_order", coursePolicySnapshotClass: "ABSENT",
      merchantSnapshotExists: false, emailDeliveryExists: false, paidOrderEventExists: false, databaseWrites: false, callbackPosts: 0, callbackReplayAuthorized: false });
    expect(merchantPostProbeCompatible(full)).toBe(true);
    expect(merchantPostProbeCompatible({ ...full, classification: "READ_FAILED", schema: [], enums: [] })).toBe(false);
    expect(merchantPostProbeCompatible({ ...full, schema: [] })).toBe(false);
    expect(merchantPostProbeCompatible({ ...full, enums: [] })).toBe(false);
    expect(merchantPostProbeCompatible({ ...full, schema: full.schema.slice(1) })).toBe(false);
    expect(merchantPostProbeCompatible({ ...full, schema: full.schema.map(() => full.schema[0]!) })).toBe(false);
    expect(merchantPostProbeCompatible({ ...full, schema: full.schema.map((row, index) => index ? row : { ...row, compatible: false }) })).toBe(false);
    expect(merchantPostProbeCompatible({ ...full, enums: full.enums.map(() => full.enums[0]!) })).toBe(false);
  });
  it("accepts only exact delivered bytes and forward DDL", () => {
    const statements = merchantStatements(sql);
    expect(statements.length).toBeGreaterThan(20);
    expect(statements.every(statement => /^(ALTER TABLE|CREATE TABLE|CREATE (UNIQUE )?INDEX|CREATE FUNCTION|CREATE TRIGGER|DO)/u.test(statement))).toBe(true);
    expect(statements.some(statement => statement.startsWith("CREATE FUNCTION") && statement.includes("RAISE EXCEPTION") && statement.includes("END $$"))).toBe(true);
    expect(statements.filter(statement => statement.startsWith("DO $$"))).toHaveLength(1);
    for (const altered of [sql + "\n", sql.replace('CREATE TABLE', 'DROP TABLE'), "SELECT 1;"]) expect(() => merchantStatements(altered)).toThrow("FIXED_MERCHANT_SCHEMA_REJECTED");
  });
  it("records actual successful SQL only after all catalog checks", async () => {
    const c = client();
    expect(await installMerchantSchema(c.tx, sql)).toEqual({ installedTables: 7, installedColumns: 4 });
    expect(c.raw.mock.calls.map(call => call[0])).toEqual(merchantStatements(sql));
    expect(c.execute).toHaveBeenCalledTimes(2);
    expect(c.execute.mock.invocationCallOrder[1]).toBeGreaterThan(c.raw.mock.invocationCallOrder.at(-1)!);
  });
  it.each([{ tables: 1 }, { columns: 1 }, { ledger: [{ checksum: "wrong", finished: true, rolled: false }] }])("rejects partial installation or any existing ledger before DDL: %j", async before => {
    const c = client(before);
    await expect(installMerchantSchema(c.tx, sql)).rejects.toThrow();
    expect(c.raw).not.toHaveBeenCalled();
    expect(c.execute).toHaveBeenCalledTimes(1);
  });
  it("does not mark an interrupted SQL batch applied", async () => {
    const c = client(); c.raw.mockRejectedValueOnce(new Error("synthetic failure"));
    await expect(installMerchantSchema(c.tx, sql)).rejects.toThrow("synthetic failure");
    expect(c.execute).toHaveBeenCalledTimes(1);
  });
  it("rejects a missing post-migration column before ledger insert", async () => {
    const c = client(); c.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 7 }, () => ({ name: "table" }))).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(installMerchantSchema(c.tx, sql)).rejects.toThrow();
    expect(c.execute).toHaveBeenCalledTimes(1);
  });
});
