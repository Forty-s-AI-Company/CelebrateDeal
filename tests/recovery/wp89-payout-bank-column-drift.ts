import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("WP-89 requires an explicit disposable database URL.");
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main() {
  try {
    const rows = await db.$queryRaw<Array<{ column_present: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'PayoutItem'
          AND column_name = 'bankAccountEncrypted'
      ) AS column_present
    `;
    if (rows[0]?.column_present !== true) {
      throw new Error("PayoutItem bankAccountEncrypted migration drift detected.");
    }
    console.log(JSON.stringify({ work_package: "WP-89", check: "payout_bank_column_drift", status: "PASS" }));
  } finally {
    await db.$disconnect();
  }
}

void main();
