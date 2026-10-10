import { PrismaClient } from "@prisma/client";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readExactSyntheticState, EXACT_SOURCE } from "./q1-exact-state-details";
import { qaFinanceDatabaseUrl, QA_FINANCE_CA_FILE, verifyQaFinanceCertificate } from "../src/lib/staging-qa-finance-bootstrap";

export const CALLBACK_EXECUTION_SOURCE = "4c1dce7e1478791a6d5526ebcf4b8f1575282009";
const ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const statuses = new Set(["PROCESSED", "ALREADY_PROCESSED", "FIXTURE_UNAVAILABLE", "CANDIDATE_AMBIGUOUS", "EVENT_UNAVAILABLE", "RETRY_REJECTED", "RETRY_FAILED"]);
const failureCodes = new Set(["NONE", "UNKNOWN", "scope_missing", "scope_invalid", "scope_mismatch", "order_ambiguous",
  "amount_mismatch", "inventory_conflict", "processing_timeout", "processing_claim_lost", "processing_failed"]);

/** Fixed single POST. Reserve possible effects before transport; never retry a lost response. */
export async function replayOriginalCallback(jobSecret: string, request: typeof fetch = fetch,
  persistReservation: () => Promise<void> = async () => {}) {
  const receipt = { status: "BLOCKED", callbackPosts: 0, possibleDatabaseWrites: false,
    callbackStatus: "INPUT_REJECTED", retryAttempts: 0, failureCode: "UNKNOWN" };
  if (!jobSecret) return receipt;
  receipt.callbackPosts = 1;
  receipt.possibleDatabaseWrites = true;
  receipt.retryAttempts = 1;
  try {
    await persistReservation();
    const response = await request(`${ORIGIN}/api/admin/ops/payuni/q1-original-callback-retry`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${jobSecret}`, "x-celebratedeal-source-sha": CALLBACK_EXECUTION_SOURCE },
    });
    const text = await response.text();
    if (response.status !== 200 || text.length > 512) throw new Error();
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).sort().join(",") !== "failureCode,retryAttempts,status"
      || !statuses.has(body.status) || !failureCodes.has(body.failureCode)
      || !Number.isInteger(body.retryAttempts) || body.retryAttempts < 0 || body.retryAttempts > 1
      || (body.status === "PROCESSED" && (body.retryAttempts !== 1 || body.failureCode !== "NONE"))
      || (body.status === "ALREADY_PROCESSED" && (body.retryAttempts !== 0 || body.failureCode !== "NONE"))) throw new Error();
    receipt.callbackStatus = body.status; receipt.retryAttempts = body.retryAttempts; receipt.failureCode = body.failureCode;
    receipt.status = ["PROCESSED", "ALREADY_PROCESSED"].includes(body.status) ? "OBSERVED" : "BLOCKED";
  } catch { receipt.callbackStatus = "TRANSPORT_OR_RESPONSE_UNVERIFIED"; }
  return receipt;
}

async function writeReceipt(receipt: Record<string, unknown>) {
  if (!process.env.RUNNER_TEMP) return;
  const directory = resolve(process.env.RUNNER_TEMP, "q1-original-callback");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "completion.json"), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
}

export async function main() {
  let db: PrismaClient | undefined;
  let stage = "configuration";
  const receipt: Record<string, unknown> = { schemaVersion: "celebratedeal-q1-original-callback/v1", status: "BLOCKED",
    executionSource: CALLBACK_EXECUTION_SOURCE, originalTransactionSource: EXACT_SOURCE,
    callbackPosts: 0, possibleDatabaseWrites: false, paymentSubmitted: false, refundSubmitted: false, productionOperations: false };
  try {
    const env = process.env;
    if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/master"
      || env.GITHUB_REF_PROTECTED !== "true" || env.PAYUNI_ENV !== "sandbox" || !env.JOB_SECRET
      || env.CELEBRATEDEAL_SOURCE_SHA !== CALLBACK_EXECUTION_SOURCE) throw new Error();
    const databaseUrl = qaFinanceDatabaseUrl(env.STAGING_DATABASE_URL ?? "");
    verifyQaFinanceCertificate(await readFile(resolve("prisma", QA_FINANCE_CA_FILE)));
    stage = "deployment-lineage";
    const { verifyMvpPayUniLineage } = await import("./mvp-payuni-sandbox-e2e.mjs");
    if (!await verifyMvpPayUniLineage({ NODE_ENV: "test", CELEBRATEDEAL_SOURCE_SHA: CALLBACK_EXECUTION_SOURCE,
      CELEBRATEDEAL_DEPLOYMENT_HOST: env.CELEBRATEDEAL_DEPLOYMENT_HOST, GITHUB_TOKEN: env.GITHUB_TOKEN })) throw new Error();
    stage = "sandbox-runtime-boundary";
    const response = await fetch(`${ORIGIN}/api/admin/ops/payuni/wp4-buyer-order-proof`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${env.JOB_SECRET}`, "x-celebratedeal-source-sha": CALLBACK_EXECUTION_SOURCE },
    });
    const proof = await response.json();
    const expected: Record<string, number> = { VERIFIED: 200, FIXTURE_UNAVAILABLE: 404, CANDIDATE_AMBIGUOUS: 409, STATE_MISMATCH: 409 };
    if (!Object.hasOwn(expected, proof?.status ?? "") || expected[proof.status] !== response.status) throw new Error();
    stage = "original-readonly-precondition";
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const before = await readExactSyntheticState(db);
    receipt.before = before;
    if (!("paymentState" in before) || before.category !== "EXACT_SYNTHETIC_STATE_OBSERVED" || before.paymentState !== "pending"
      || before.paymentSubmissionReserved !== true || before.callbackRetryReserved !== false
      || before.callback?.callbackState !== "failed" || before.callback.callbackRetryBudgetAvailable !== true
      || !["UNASSIGNED", "MATCHED"].includes(before.callback.callbackTenantState ?? "")) throw new Error();
    stage = "original-callback-replay";
    Object.assign(receipt, await replayOriginalCallback(env.JOB_SECRET, fetch, async () => {
      // A killed runner must retain conservative possible effects before POST.
      Object.assign(receipt, { callbackPosts: 1, possibleDatabaseWrites: true, stage });
      await writeReceipt(receipt);
    }));
    stage = "original-readonly-after";
    const after = await readExactSyntheticState(db); receipt.after = after;
    if (!("paymentState" in after) || receipt.status !== "OBSERVED" || after.paymentState !== "paid" || after.callback?.callbackState !== "processed"
      || after.callback.callbackTenantState !== "MATCHED" || after.paidEventCount !== 1
      || after.orderState !== "paid" || after.orderPaidAmountMatches !== true
      || after.providerTradeNumberPresent !== true || after.reservationState !== "committed"
      || after.reservationProductMatches !== true) throw new Error();
    receipt.status = "ORIGINAL_CALLBACK_PROJECTION_VERIFIED";
  } catch { receipt.status = "BLOCKED"; receipt.stage = stage; process.exitCode = 1; }
  finally {
    try { await db?.$disconnect(); } catch { receipt.status = "BLOCKED"; receipt.stage = "database-disconnect"; process.exitCode = 1; }
    await writeReceipt(receipt);
    console.log(JSON.stringify(receipt));
  }
}
