import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * B04-04: indexes that schema.prisma cannot express. `prisma migrate diff`
 * does not compare partial indexes at all, so the drift check in
 * scripts/prisma-drift-check.mjs cannot notice if a migration drops or
 * rebuilds one. These indexes carry business invariants (one active booking
 * per slot, one spotlight per live, one active credit per source order, one
 * active upline, one pending settlement adjustment, one open login email
 * change per user) or keep buyer search off full-table scans, so assert the
 * complete definition (columns, method, operator class and predicate).
 */
// pg_get_indexdef always schema-qualifies the table; the suite runs in public
// and, for the concurrency rerun, in disposable wp17_ci/wp18_ci schemas built
// by the same migrations.
function expectedIndexDefinitions(schema: string): Record<string, string> {
  return {
    ConsultationBooking_active_slot_key:
      `CREATE UNIQUE INDEX "ConsultationBooking_active_slot_key" ON ${schema}."ConsultationBooking" USING btree ("vendorId", "eventId", "startTime") WHERE (status = 'scheduled'::"ConsultationBookingStatus")`,
    FormSubmission_email_trgm_idx:
      `CREATE INDEX "FormSubmission_email_trgm_idx" ON ${schema}."FormSubmission" USING gin (email gin_trgm_ops)`,
    FormSubmission_name_trgm_idx:
      `CREATE INDEX "FormSubmission_name_trgm_idx" ON ${schema}."FormSubmission" USING gin (name gin_trgm_ops)`,
    FormSubmission_phone_trgm_idx:
      `CREATE INDEX "FormSubmission_phone_trgm_idx" ON ${schema}."FormSubmission" USING gin (phone gin_trgm_ops)`,
    LiveQuestion_one_spotlight_per_live_key:
      `CREATE UNIQUE INDEX "LiveQuestion_one_spotlight_per_live_key" ON ${schema}."LiveQuestion" USING btree ("liveId") WHERE (status = 'spotlight'::"LiveQuestionStatus")`,
    SettlementAdjustmentRequest_one_pending_per_settlement:
      `CREATE UNIQUE INDEX "SettlementAdjustmentRequest_one_pending_per_settlement" ON ${schema}."SettlementAdjustmentRequest" USING btree ("settlementId") WHERE (status = 'pending'::text)`,
    PostPurchaseCredit_vendorId_sourceOrderId_active_key:
      `CREATE UNIQUE INDEX "PostPurchaseCredit_vendorId_sourceOrderId_active_key" ON ${schema}."PostPurchaseCredit" USING btree ("vendorId", "sourceOrderId") WHERE ("releasedAt" IS NULL)`,
    TeamMembershipRelationship_one_active_upline:
      `CREATE UNIQUE INDEX "TeamMembershipRelationship_one_active_upline" ON ${schema}."TeamMembershipRelationship" USING btree ("downlineMembershipId") WHERE ("endedAt" IS NULL)`,
    UserEmailChangeRequest_one_open_per_user:
      `CREATE UNIQUE INDEX "UserEmailChangeRequest_one_open_per_user" ON ${schema}."UserEmailChangeRequest" USING btree ("userId") WHERE (("consumedAt" IS NULL) AND ("revokedAt" IS NULL))`,
  };
}

describe("indexes Prisma cannot express", () => {
  it("keeps every partial unique and trigram index with its exact definition", async () => {
    const [current] = await getDb().$queryRaw<Array<{ schema: string | null }>>`SELECT pg_catalog.current_schema() AS schema`;
    const targetSchema = current?.schema ?? "";
    expect(targetSchema).toMatch(/^[a-z_][a-z0-9_]*$/);
    const expected = expectedIndexDefinitions(targetSchema);
    const rows = await getDb().$queryRaw<Array<{ index: string; definition: string; valid: boolean }>>`
      SELECT index_class.relname AS index,
             pg_catalog.pg_get_indexdef(index_class.oid) AS definition,
             pg_index.indisvalid AS valid
      FROM pg_catalog.pg_index
      INNER JOIN pg_catalog.pg_class AS index_class ON index_class.oid = pg_index.indexrelid
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
      WHERE namespace.nspname = ${targetSchema}
        AND index_class.relname = ANY(${Object.keys(expected)}::text[])
      ORDER BY index_class.relname
    `;
    expect(Object.fromEntries(rows.map((row) => [row.index, row.definition]))).toEqual(expected);
    expect(rows.every((row) => row.valid)).toBe(true);
  });
});
