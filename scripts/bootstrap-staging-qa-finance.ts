import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureStagingQaFinance, qaFinanceDatabaseUrl, QaFinanceBootstrapFailure } from "../src/lib/staging-qa-finance-bootstrap";
import { isStagingDatabaseUrl } from "../src/lib/database-identity";

const APP_ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";

/** Persist the same closed result, never provider errors or injected values. */
async function report(result: { status?: string; stage?: string; email?: string; outcome?: string; failureCategory?: string }) {
  const receipt = { schemaVersion: "celebratedeal-staging-qa-finance-bootstrap/v1", ...result,
    productionOperations: false, providerOperations: false };
  if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF === "refs/heads/master"
    && process.env.GITHUB_REF_PROTECTED === "true" && process.env.RUNNER_TEMP) {
    const directory = resolve(process.env.RUNNER_TEMP, "qa-finance-bootstrap");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "completion.json"), `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  console.log(JSON.stringify(receipt));
}

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
    stage = "standalone-runner-load";
    // Native ESM import keeps the standalone runner's top-level await intact.
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
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
    await report(result);
  } catch (error) {
    await report({ status: "BLOCKED_OR_FAILED", stage,
      ...(error instanceof QaFinanceBootstrapFailure ? { failureCategory: error.category } : {}) });
    process.exitCode = 1;
  } finally {
    await db?.$disconnect();
  }
}
void main();
