import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * B04-04: indexes that schema.prisma cannot express. `prisma migrate diff`
 * does not compare partial indexes at all, so the drift check in
 * scripts/prisma-drift-check.mjs cannot notice if a migration drops one.
 * These indexes carry business invariants (one active booking per slot, one
 * spotlight per live, one active credit per source order, one active upline)
 * or keep buyer search off full-table scans, so assert them directly.
 */
const PARTIAL_UNIQUE_INDEXES = [
  { index: "ConsultationBooking_active_slot_key", table: "ConsultationBooking" },
  { index: "LiveQuestion_one_spotlight_per_live_key", table: "LiveQuestion" },
  { index: "PostPurchaseCredit_vendorId_sourceOrderId_active_key", table: "PostPurchaseCredit" },
  { index: "TeamMembershipRelationship_one_active_upline", table: "TeamMembershipRelationship" },
];
const TRIGRAM_INDEXES = ["FormSubmission_email_trgm_idx", "FormSubmission_name_trgm_idx", "FormSubmission_phone_trgm_idx"];

describe("indexes Prisma cannot express", () => {
  it("keeps every partial unique index", async () => {
    const rows = await getDb().$queryRaw<Array<{ index: string; table: string; unique: boolean; partial: boolean }>>`
      SELECT index_class.relname AS index, table_class.relname AS table,
             pg_index.indisunique AS unique, pg_index.indpred IS NOT NULL AS partial
      FROM pg_catalog.pg_index
      INNER JOIN pg_catalog.pg_class AS index_class ON index_class.oid = pg_index.indexrelid
      INNER JOIN pg_catalog.pg_class AS table_class ON table_class.oid = pg_index.indrelid
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
      WHERE namespace.nspname = 'public' AND index_class.relname = ANY(${PARTIAL_UNIQUE_INDEXES.map((entry) => entry.index)}::text[])
      ORDER BY index_class.relname
    `;
    expect(rows).toEqual(PARTIAL_UNIQUE_INDEXES.map((entry) => ({ ...entry, unique: true, partial: true })));
  });

  it("keeps the FormSubmission trigram GIN indexes", async () => {
    const rows = await getDb().$queryRaw<Array<{ index: string; method: string; opclass: string }>>`
      SELECT index_class.relname AS index, access_method.amname AS method, operator_class.opcname AS opclass
      FROM pg_catalog.pg_index
      INNER JOIN pg_catalog.pg_class AS index_class ON index_class.oid = pg_index.indexrelid
      INNER JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_class.relam
      INNER JOIN pg_catalog.pg_opclass AS operator_class ON operator_class.oid = pg_index.indclass[0]
      WHERE index_class.relname = ANY(${TRIGRAM_INDEXES}::text[])
        AND pg_index.indrelid = '"FormSubmission"'::regclass
      ORDER BY index_class.relname
    `;
    expect(rows).toEqual(TRIGRAM_INDEXES.map((index) => ({ index, method: "gin", opclass: "gin_trgm_ops" })));
  });
});
