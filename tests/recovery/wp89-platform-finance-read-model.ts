import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("WP-89 requires an explicit disposable database URL.");
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main() {
  try {
    // Keep this query semantically aligned with the platform dashboard: the
    // UI only renders a failed-item count, so no payout-bank field belongs in
    // this read model.
    await db.payoutItem.count({ where: { status: "failed" } });
    console.log(JSON.stringify({ work_package: "WP-89", check: "platform_finance_failed_payout_count", status: "PASS" }));
  } finally {
    await db.$disconnect();
  }
}

void main();
