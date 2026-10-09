import { PrismaClient } from "@prisma/client";
import { ensureStagingQaFinance, qaFinanceDatabaseUrl } from "../src/lib/staging-qa-finance-bootstrap";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";
import { verifyMvpPayUniLineage } from "./mvp-payuni-sandbox-e2e.mjs";

const APP_ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";

/** Protected CI only. No dotenv, secret inspection, login bypass or payments. */
async function main() {
  let db: PrismaClient | undefined;
  let stage = "configuration";
  try {
    const env = process.env;
    if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/master"
      || env.GITHUB_REF_PROTECTED !== "true" || env.PAYUNI_ENV !== "sandbox"
      || !env.JOB_SECRET || !env.PAYUNI_QA_FINANCE_PASSWORD
      || !isStagingDatabaseUrl(env.STAGING_DATABASE_URL)) throw new Error();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL!);
    stage = "deployment-lineage";
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: env.CELEBRATEDEAL_SOURCE_SHA,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) throw new Error();
    stage = "sandbox-runtime-preflight";
    const response = await fetch(`${APP_ORIGIN}/api/admin/ops/payuni/wp4-preflight`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": env.CELEBRATEDEAL_SOURCE_SHA! },
    });
    if (response.status !== 200) throw new Error();
    const readiness = await response.json();
    if (readiness.ready !== true || readiness.buyerOrder !== true) throw new Error();
    stage = "fixed-synthetic-account";
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const result = await ensureStagingQaFinance(db, { databaseUrl, sourceSha: env.CELEBRATEDEAL_SOURCE_SHA!,
      password: env.PAYUNI_QA_FINANCE_PASSWORD, runtimeReady: true, payuniEnv: env.PAYUNI_ENV });
    console.log(JSON.stringify({ schemaVersion: "celebratedeal-staging-qa-finance-bootstrap/v1", ...result,
      productionOperations: false, providerOperations: false }));
  } catch {
    console.log(JSON.stringify({ schemaVersion: "celebratedeal-staging-qa-finance-bootstrap/v1", status: "BLOCKED_OR_FAILED", stage,
      productionOperations: false, providerOperations: false }));
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
void main();
