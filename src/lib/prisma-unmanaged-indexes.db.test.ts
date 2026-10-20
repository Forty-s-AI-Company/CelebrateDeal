import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";

/**
 * B04-04: indexes that schema.prisma cannot express. `prisma migrate diff`
 * does not compare partial indexes at all, so the drift check in
 * scripts/prisma-drift-check.mjs cannot notice if a migration drops or
 * rebuilds one. These indexes carry business invariants (one active booking
 * per slot, one spotlight per live, one active credit per source order, one
 * active upline) or keep buyer search off full-table scans, so assert the
 * complete definition (columns, method, operator class and predicate).
 */
const EXPECTED_INDEX_DEFINITIONS: Record<string, string> = {
  ConsultationBooking_active_slot_key:
    `CREATE UNIQUE INDEX "ConsultationBooking_active_slot_key" ON public."ConsultationBooking" USING btree ("vendorId", "eventId", "startTime") WHERE (status = 'scheduled'::"ConsultationBookingStatus")`,
  FormSubmission_email_trgm_idx:
    `CREATE INDEX "FormSubmission_email_trgm_idx" ON public."FormSubmission" USING gin (email gin_trgm_ops)`,
  FormSubmission_name_trgm_idx:
    `CREATE INDEX "FormSubmission_name_trgm_idx" ON public."FormSubmission" USING gin (name gin_trgm_ops)`,
  FormSubmission_phone_trgm_idx:
    `CREATE INDEX "FormSubmission_phone_trgm_idx" ON public."FormSubmission" USING gin (phone gin_trgm_ops)`,
  LiveQuestion_one_spotlight_per_live_key:
    `CREATE UNIQUE INDEX "LiveQuestion_one_spotlight_per_live_key" ON public."LiveQuestion" USING btree ("liveId") WHERE (status = 'spotlight'::"LiveQuestionStatus")`,
  PostPurchaseCredit_vendorId_sourceOrderId_active_key:
    `CREATE UNIQUE INDEX "PostPurchaseCredit_vendorId_sourceOrderId_active_key" ON public."PostPurchaseCredit" USING btree ("vendorId", "sourceOrderId") WHERE ("releasedAt" IS NULL)`,
  TeamMembershipRelationship_one_active_upline:
    `CREATE UNIQUE INDEX "TeamMembershipRelationship_one_active_upline" ON public."TeamMembershipRelationship" USING btree ("downlineMembershipId") WHERE ("endedAt" IS NULL)`,
};

describe("indexes Prisma cannot express", () => {
  it("keeps every partial unique and trigram index with its exact definition", async () => {
    const rows = await getDb().$queryRaw<Array<{ index: string; definition: string; valid: boolean }>>`
      SELECT index_class.relname AS index,
             pg_catalog.pg_get_indexdef(index_class.oid) AS definition,
             pg_index.indisvalid AS valid
      FROM pg_catalog.pg_index
      INNER JOIN pg_catalog.pg_class AS index_class ON index_class.oid = pg_index.indexrelid
      INNER JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_class.relname = ANY(${Object.keys(EXPECTED_INDEX_DEFINITIONS)}::text[])
      ORDER BY index_class.relname
    `;
    expect(Object.fromEntries(rows.map((row) => [row.index, row.definition]))).toEqual(EXPECTED_INDEX_DEFINITIONS);
    expect(rows.every((row) => row.valid)).toBe(true);
  });
});
