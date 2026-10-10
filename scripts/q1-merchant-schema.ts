import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { qaFinanceDatabaseUrl, QA_FINANCE_CA_FILE, verifyQaFinanceCertificate } from "../src/lib/staging-qa-finance-bootstrap";
import { fetchQ1Downstream, readQ1DiagnosticFence, readQ1FenceState } from "./q1-downstream-runtime";
import { readOriginalRetryAudit } from "./q1-original-retry-audit";

export const MERCHANT_MIGRATION = "20261006120000_merchant_affiliate_policy_snapshots";
export const MERCHANT_SQL_SHA256 = "1dc83cfe4e3db8d6116c116e6e918625f125ccc802bed306d3f85a076132c3dd";
export const MERCHANT_TABLES = ["MerchantAffiliatePolicy", "MerchantAffiliatePolicyState", "MerchantAffiliateProductRate", "MerchantAffiliateCheckoutSnapshot", "MerchantAffiliateCheckoutRecipient", "MerchantAffiliateSalesCounter", "MerchantAffiliateCalculation"] as const;
const COLUMNS = ["merchantCalculationId", "merchantCheckoutId", "merchantLevel", "merchantRecipientId"] as const;
const EXPECTED_APP = "84edba3958a5a3e7e25aa3915a701a936e41bdc1";
const EXPECTED_HOST = "celebrate-deal-staging-3w0dm0sa8-a25814740s-projects.vercel.app";
const rejected = () => new Error("FIXED_MERCHANT_SCHEMA_REJECTED");

/** Only the already delivered, byte-pinned forward migration is executable. */
export function merchantStatements(sql: string) {
  if (createHash("sha256").update(sql).digest("hex") !== MERCHANT_SQL_SHA256) throw rejected();
  // The pinned migration includes PL/pgSQL guards. Keep dollar-quoted bodies
  // and quoted strings intact; their internal semicolons are not SQL splits.
  const text = sql.replace(/^--.*$/gm, "");
  const statements = (text.match(/(?:\$\$[\s\S]*?\$\$|'(?:''|[^'])*'|"(?:""|[^"])*"|[^;'"$]|\$(?!\$))+/gu) ?? [])
    .map(value => value.trim()).filter(Boolean);
  if (!statements.length || statements.some(value => !/^(?:ALTER TABLE|CREATE TABLE|CREATE (?:UNIQUE )?INDEX|CREATE FUNCTION|CREATE TRIGGER|DO)\s/u.test(value))) throw rejected();
  return statements;
}

/** Read catalog and ledger only; partial installation is never marked applied. */
export async function merchantSchemaState(tx: Prisma.TransactionClient) {
  const tables = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_name IN (${Prisma.join([...MERCHANT_TABLES])})`);
  const columns = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT column_name AS name FROM information_schema.columns WHERE table_schema='public' AND table_name='AffiliateCommission' AND column_name IN (${Prisma.join([...COLUMNS])})`);
  const ledger = await tx.$queryRaw<{ checksum: string; finished: boolean; rolled: boolean }[]>(Prisma.sql`SELECT checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled FROM public._prisma_migrations WHERE migration_name=${MERCHANT_MIGRATION}`);
  return { tables: tables.length, columns: columns.length, ledger };
}

/** Caller owns the transaction. DDL and its actual-success ledger entry commit
 * together; no payment, callback, retry marker or commission row is changed. */
export async function installMerchantSchema(tx: Prisma.TransactionClient, sql: string) {
  const statements = merchantStatements(sql);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261006, 120000)`;
  const before = await merchantSchemaState(tx);
  if (before.ledger.length || before.tables || before.columns) throw rejected();
  for (const statement of statements) await tx.$executeRawUnsafe(statement);
  const after = await merchantSchemaState(tx);
  if (after.tables !== MERCHANT_TABLES.length || after.columns !== COLUMNS.length || after.ledger.length) throw rejected();
  // This records SQL that actually ran successfully inside this transaction.
  await tx.$executeRaw(Prisma.sql`INSERT INTO public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (${randomUUID()}, ${MERCHANT_SQL_SHA256}, CURRENT_TIMESTAMP, ${MERCHANT_MIGRATION}, NULL, NULL, CURRENT_TIMESTAMP, 1)`);
  return { installedTables: after.tables, installedColumns: after.columns };
}

export async function main() {
  let db: PrismaClient | undefined;
  let stage = "configuration";
  const receipt: Record<string, unknown> = { schemaVersion: "celebratedeal-q1-merchant-schema/v1", status: "BLOCKED", migration: MERCHANT_MIGRATION, migrationApplied: false, callbackPosts: 0, callbackReplayAuthorized: false, paymentSubmitted: false, refundSubmitted: false, productionOperations: false };
  try {
    const env = process.env;
    if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/master" || env.GITHUB_REF_PROTECTED !== "true" || env.GITHUB_REPOSITORY !== "Forty-s-AI-Company/CelebrateDeal" || env.GITHUB_WORKFLOW_REF?.split("@")[0] !== "Forty-s-AI-Company/CelebrateDeal/.github/workflows/q1-merchant-schema.yml" || env.PAYUNI_ENV !== "sandbox" || env.CELEBRATEDEAL_SOURCE_SHA !== EXPECTED_APP || env.CELEBRATEDEAL_DEPLOYMENT_HOST !== EXPECTED_HOST) throw rejected();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL ?? "");
    // Interactive DDL needs a direct or session pooler, never transaction pooling.
    if (new URL(databaseUrl).port === "6543") throw rejected();
    verifyQaFinanceCertificate(await readFile(resolve("prisma", QA_FINANCE_CA_FILE)));
    const sql = await readFile(resolve("prisma/migrations", MERCHANT_MIGRATION, "migration.sql"), "utf8");
    merchantStatements(sql);
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: EXPECTED_APP, CELEBRATEDEAL_DEPLOYMENT_HOST: EXPECTED_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) throw rejected();
    stage = "sandbox-runtime-and-schema";
    // The deployed API checks Sandbox/project/DB/source before its readonly
    // probe. A runner-side PAYUNI_ENV alone cannot attest the deployed runtime.
    const observed = await fetchQ1Downstream(env.JOB_SECRET ?? "", EXPECTED_APP);
    if (observed.classification !== "SCHEMA_INCOMPATIBLE"
      || !observed.schema.some(row => row.model === "MerchantAffiliateCheckoutSnapshot" && !row.compatible)
      || !observed.schema.some(row => row.model === "AffiliateCommission" && !row.compatible)) throw rejected();
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    stage = "original-readonly-fence";
    const original = await readQ1DiagnosticFence(db), audit = await readOriginalRetryAudit(db);
    if (!("schedulerCount" in audit) || audit.schedulerCount !== 0 || audit.retryCount !== 3) throw rejected();
    stage = "atomic-forward-migration";
    const installed = await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '45s'`;
      const fixed = JSON.parse(original) as { payment: { id: string }; event: { id: string } };
      // Locks preserve this exact transaction and event until DDL commits.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "PaymentTransaction" WHERE id=${fixed.payment.id} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "WebhookEvent" WHERE id=${fixed.event.id} FOR UPDATE`);
      if (await readQ1FenceState(tx) !== original) throw rejected();
      const result = await installMerchantSchema(tx, sql);
      if (await readQ1FenceState(tx) !== original) throw rejected();
      return result;
    }, { timeout: 60000 });
    receipt.migrationApplied = true;
    stage = "original-readonly-after";
    const after = await readQ1DiagnosticFence(db), auditAfter = await readOriginalRetryAudit(db);
    if (after !== original || !("schedulerCount" in auditAfter) || auditAfter.schedulerCount !== 0 || auditAfter.retryCount !== 3 || auditAfter.fixedActorCount !== audit.fixedActorCount) throw rejected();
    Object.assign(receipt, { status: "FORWARD_MIGRATION_APPLIED", ...installed, originalStateUnchanged: true, schedulerCount: 0, retryCount: 3 });
    stage = "deployed-readonly-after";
    const downstream = await fetchQ1Downstream(env.JOB_SECRET ?? "", EXPECTED_APP);
    Object.assign(receipt, { downstreamClassification: downstream.classification, decrypt: downstream.decrypt, protect: downstream.protect,
      schemaCompatible: downstream.schema.every(row => row.compatible) && downstream.enums.every(row => row.compatible) });
    if (!receipt.schemaCompatible) throw rejected();
  } catch { receipt.status = "BLOCKED"; receipt.stage = stage; process.exitCode = 1; }
  finally {
    try { await db?.$disconnect(); } catch { receipt.status = "BLOCKED"; receipt.stage = "disconnect"; process.exitCode = 1; }
    if (process.env.RUNNER_TEMP && process.env.GITHUB_REF === "refs/heads/master" && process.env.GITHUB_REF_PROTECTED === "true") {
      const directory = resolve(process.env.RUNNER_TEMP, "q1-merchant-schema");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "completion.json"), JSON.stringify(receipt) + "\n", { mode: 0o600 });
    }
    console.log(JSON.stringify(receipt));
  }
}
