import { getDb } from "../src/lib/db";
import { automationCustomerKeyHash } from "../src/lib/automation-workflow";

const BATCH_SIZE = 200;

/** Local/staging-only, idempotent identity backfill. Never prints customer PII. */
async function main() {
  if (process.env.NODE_ENV === "production" || process.env.CUSTOMER_CRM_BACKFILL_CONFIRM !== "local_or_staging") {
    throw new Error("Customer CRM backfill requires an explicit local/staging confirmation.");
  }
  const db = getDb();
  let submissionsUpdated = 0;
  let bookingsUpdated = 0;
  let streamEntriesUpdated = 0;
  while (true) {
    const rows = await db.formSubmission.findMany({ where: { customerKeyHash: null }, select: { id: true, email: true, form: { select: { vendorId: true } } }, take: BATCH_SIZE, orderBy: { id: "asc" } });
    if (!rows.length) break;
    for (const row of rows) submissionsUpdated += (await db.formSubmission.updateMany({ where: { id: row.id, customerKeyHash: null, form: { vendorId: row.form.vendorId } }, data: { customerKeyHash: automationCustomerKeyHash(row.form.vendorId, row.email) } })).count;
  }
  while (true) {
    const rows = await db.consultationBooking.findMany({ where: { customerKeyHash: null }, select: { id: true, vendorId: true, clientEmail: true }, take: BATCH_SIZE, orderBy: { id: "asc" } });
    if (!rows.length) break;
    for (const row of rows) bookingsUpdated += (await db.consultationBooking.updateMany({ where: { id: row.id, vendorId: row.vendorId, customerKeyHash: null }, data: { customerKeyHash: automationCustomerKeyHash(row.vendorId, row.clientEmail) } })).count;
  }
  // Older registered-viewer events can be recovered from their tenant-bound
  // automation log. Anonymous viewer hashes are intentionally never promoted
  // into customer identities.
  let streamCursor: string | undefined;
  while (true) {
    const rows = await db.streamUsageLedgerEntry.findMany({
      where: { customerKeyHash: null },
      select: { id: true, vendorId: true, eventId: true },
      take: BATCH_SIZE,
      orderBy: { id: "asc" },
      ...(streamCursor ? { cursor: { id: streamCursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    streamCursor = rows.at(-1)!.id;
    const eventIds = rows.map((row) => row.eventId);
    const logs = await db.automationExecutionLog.findMany({
      where: { eventId: { in: eventIds }, subjectType: "buyer_registration", subjectKeyHash: { not: null } },
      select: { vendorId: true, eventId: true, subjectKeyHash: true },
    });
    const hashByEvent = new Map(logs.map((log) => [`${log.vendorId}:${log.eventId}`, log.subjectKeyHash!]));
    for (const row of rows) {
      const customerKeyHash = hashByEvent.get(`${row.vendorId}:${row.eventId}`);
      if (customerKeyHash) streamEntriesUpdated += (await db.streamUsageLedgerEntry.updateMany({ where: { id: row.id, vendorId: row.vendorId, customerKeyHash: null }, data: { customerKeyHash } })).count;
    }
  }
  process.stdout.write(JSON.stringify({ status: "complete", submissionsUpdated, bookingsUpdated, streamEntriesUpdated }) + "\n");
}

main().catch(() => {
  process.stderr.write("customer_crm_backfill_failed\n");
  process.exitCode = 1;
});
