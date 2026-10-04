import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertLinkedStagingProject,
  currentUserSid,
  restrictToCurrentUser,
  sanitizedCliEnvironment,
} from "./staging-payuni-management-prepare";
import {
  PAYUNI_STAGING_APP_ORIGIN,
  PAYUNI_STAGING_PLAN_PERMIT_PREFIX,
  PAYUNI_STAGING_PLAN_PRICES_CENTS,
  PAYUNI_STAGING_RETRY_VENDOR_ID,
  PAYUNI_STAGING_RETRY_TRANSACTION_ID,
  PAYUNI_STAGING_RETRY_ORDER_NUMBER,
  PAYUNI_STAGING_RETRY_MERCHANT_ID,
} from "../src/lib/payuni-staging-plan-test";

// This command only binds or revokes the three fixed staging test plans. The
// linked project, CLI profile, merchant and deployment hostname are fixed.
const MAIN_WORKSPACE = "C:\\Users\\eden\\Downloads\\AI\\CelebrateDeal";
const STAGING_PROFILE = "celebratedeal-staging-20261002";
const STAGING_PROJECT_REF = "ocbugvgojrunvenozsbx";
const STAGING_PROJECT_ID = "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn";
const STAGING_BRANCH = "codex/prelaunch-engineering-20260929";
const TEST_EMAIL = "zeroyuanbrothers@gmail.com";
const TEST_SLUG = "payuni-plan-test";
const MERCHANT_ID = "HTCU1130301000101";
const HOST_PATTERN = /^celebrate-deal-staging-[a-z0-9]{6,32}-a25814740s-projects\.vercel\.app$/u;
const VENDOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/u;
const CODES = Object.keys(PAYUNI_STAGING_PLAN_PRICES_CENTS) as Array<keyof typeof PAYUNI_STAGING_PLAN_PRICES_CENTS>;

type PermitMode = "enable" | "enable-retry" | "disable";

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function codesSql() {
  return CODES.map(literal).join(", ");
}

export function assertPermitEnvironment(env: NodeJS.ProcessEnv, mode: PermitMode) {
  if (env.STAGING_PAYUNI_TEST_CHANGE_APPROVED !== "true") throw new Error("PERMIT_CHANGE_NOT_APPROVED");
  // Emergency revocation remains available if the deployment, merchant or
  // unrelated runtime flags drift. The linked staging target is checked later.
  if (mode === "disable") return;
  if (mode === "enable-retry" && env.STAGING_PAYUNI_PENDING_RETRY_APPROVED !== "true") {
    throw new Error("PERMIT_RETRY_NOT_APPROVED");
  }
  const vendorId = env.PAYUNI_STAGING_PLAN_TEST_VENDOR_ID ?? "";
  const host = env.PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST ?? "";
  if (env.VERCEL_ENV !== "preview"
    || env.VERCEL_PROJECT_ID !== STAGING_PROJECT_ID
    || env.VERCEL_GIT_COMMIT_REF !== STAGING_BRANCH
    || env.NEXT_PUBLIC_APP_URL !== PAYUNI_STAGING_APP_ORIGIN
    || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${STAGING_PROJECT_REF}.supabase.co`
    || env.PAYMENT_PROVIDER !== "payuni"
    || env.PAYUNI_ENV !== "production"
    || env.PAYUNI_LIVE_PROBE_ENABLED === "true"
    || env.PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID !== MERCHANT_ID
    || !VENDOR_ID_PATTERN.test(vendorId)
    || !HOST_PATTERN.test(host)) {
    throw new Error("PERMIT_ENABLE_TARGET_INVALID");
  }
  if (mode === "enable-retry" && (vendorId !== PAYUNI_STAGING_RETRY_VENDOR_ID
    || env.PAYUNI_STAGING_PLAN_TEST_ACKNOWLEDGED_PENDING_TRANSACTION_ID !== PAYUNI_STAGING_RETRY_TRANSACTION_ID)) {
    throw new Error("PERMIT_RETRY_TARGET_INVALID");
  }
}

export function buildPermitSql(mode: PermitMode, input?: { vendorId: string; host: string; merchantId: string }) {
  if (mode !== "disable" && (!input || !VENDOR_ID_PATTERN.test(input.vendorId)
    || !HOST_PATTERN.test(input.host) || input.merchantId !== MERCHANT_ID)) {
    throw new Error("PERMIT_ENABLE_TARGET_INVALID");
  }
  if (mode === "enable-retry" && (input?.vendorId !== PAYUNI_STAGING_RETRY_VENDOR_ID
    || input.merchantId !== PAYUNI_STAGING_RETRY_MERCHANT_ID)) throw new Error("PERMIT_RETRY_TARGET_INVALID");
  const expectedPlans = CODES.map((code) => `(${literal(code)}, ${PAYUNI_STAGING_PLAN_PRICES_CENTS[code]})`).join(", ");
  const prefix = `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $staging_payuni_permit$
DECLARE
  matched integer;
  affected integer;
  permit_text text;
  original_permit_text text;
  original_permit jsonb;
  acknowledged_subscription_id text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(351, 20261003);
  IF current_setting('transaction_isolation') <> 'serializable' THEN
    RAISE EXCEPTION 'PERMIT_ISOLATION_INVALID';
  END IF;`;

  if (mode === "disable") {
    return `${prefix}
  SELECT count(*) INTO matched FROM public."BillingPlan"
    WHERE "code" IN (${codesSql()}) AND ("description" IS NOT NULL OR "isActive" = true);
  UPDATE public."BillingPlan" SET "description" = NULL, "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "code" IN (${codesSql()}) AND ("description" IS NOT NULL OR "isActive" = true);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> matched THEN RAISE EXCEPTION 'PERMIT_DISABLE_COUNT_INVALID'; END IF;
  SELECT count(*) INTO matched FROM public."BillingPlan"
    WHERE "code" IN (${codesSql()}) AND ("description" IS NOT NULL OR "isActive" = true);
  IF matched <> 0 THEN RAISE EXCEPTION 'PERMIT_DISABLE_VERIFICATION_FAILED'; END IF;
END
$staging_payuni_permit$;
COMMIT;`;
  }

  const target = input!;
  const retry = mode === "enable-retry";
  const retryGuards = retry ? `
  -- Retain the old payment row and immutable server snapshot. Only its
  -- subscription may later be superseded by the normal checkout lifecycle.
  PERFORM 1 FROM public."PaymentTransaction" WHERE "id" = ${literal(PAYUNI_STAGING_RETRY_TRANSACTION_ID)} FOR UPDATE;
  SELECT count(*), min(payment."metadata"->>'stagingPayUniPlanPermit'), min(subscription."id")
    INTO matched, original_permit_text, acknowledged_subscription_id
    FROM public."PaymentTransaction" AS payment
    JOIN public."VendorSubscription" AS subscription ON subscription."id" = payment."metadata"->>'platformSubscriptionId'
    JOIN public."BillingPlan" AS plan ON plan."id" = subscription."planId"
    WHERE payment."id" = ${literal(PAYUNI_STAGING_RETRY_TRANSACTION_ID)}
      AND payment."vendorId" = ${literal(target.vendorId)} AND subscription."vendorId" = payment."vendorId"
      AND payment."orderNumber" = ${literal(PAYUNI_STAGING_RETRY_ORDER_NUMBER)}
      AND payment."providerName" = 'payuni' AND payment."paymentMode" = 'platform'
      AND payment."status" = 'pending' AND payment."providerTradeNo" IS NULL
      AND payment."grossAmountCents" = 100 AND payment."currency" = 'TWD'
      AND payment."checkoutIdempotencyKey" = 'platform-plan:v1:' || payment."vendorId" || ':' || plan."id"
      AND subscription."status" IN ('pending_payment', 'payment_superseded')
      AND plan."code" = 'staging-payuni-starter' AND plan."monthlyPriceCents" = 100 AND plan."isActive" = false
      AND payment."metadata"->>'billingPurpose' = 'platform_subscription_checkout'
      AND payment."metadata"->>'billingPlanId' = plan."id"
      AND payment."metadata"->>'billingPlanCode' = plan."code"
      AND payment."metadata"->'checkoutSession'->>'provider' = 'payuni'
      AND payment."metadata"->'checkoutSession'->>'mode' = 'form_post'
      AND payment."metadata"->'checkoutSession'->>'formMethod' = 'POST'
      AND payment."metadata"->'checkoutSession'->>'formAction' = 'https://api.payuni.com.tw/api/upp'
      AND payment."metadata"->'checkoutSession'->'formPayload'->>'MerID' = ${literal(target.merchantId)};
  IF matched <> 1 OR original_permit_text IS NULL THEN RAISE EXCEPTION 'PERMIT_RETRY_OLD_PAYMENT_INVALID'; END IF;
  BEGIN
    IF left(original_permit_text, length(${literal(PAYUNI_STAGING_PLAN_PERMIT_PREFIX)})) <> ${literal(PAYUNI_STAGING_PLAN_PERMIT_PREFIX)} THEN
      RAISE EXCEPTION 'PERMIT_RETRY_OLD_PERMIT_INVALID';
    END IF;
    original_permit := substring(original_permit_text FROM length(${literal(PAYUNI_STAGING_PLAN_PERMIT_PREFIX)}) + 1)::jsonb;
    IF jsonb_typeof(original_permit) IS DISTINCT FROM 'object'
      OR original_permit->>'vendorId' IS DISTINCT FROM ${literal(target.vendorId)}
      OR original_permit->>'merchantId' IS DISTINCT FROM ${literal(target.merchantId)}
      OR (original_permit->>'deploymentHost') IS NULL
      OR (original_permit->>'deploymentHost') !~ '^celebrate-deal-staging-[a-z0-9]{6,32}-a25814740s-projects[.]vercel[.]app$'
      OR original_permit ? 'retryAttemptId' OR original_permit ? 'acknowledgedPendingTransactionId'
      OR (original_permit->>'expiresAt') IS NULL
      OR NOT isfinite((original_permit->>'expiresAt')::timestamptz)
      OR (original_permit->>'expiresAt')::timestamptz > CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'PERMIT_RETRY_OLD_PERMIT_INVALID';
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'PERMIT_RETRY_OLD_PERMIT_INVALID'; END;
  SELECT count(*) INTO matched FROM public."PaymentTransaction"
    WHERE "vendorId" = ${literal(target.vendorId)}
      AND "metadata"->>'stagingPayUniAcknowledgedPendingTransactionId' = ${literal(PAYUNI_STAGING_RETRY_TRANSACTION_ID)};
  IF matched <> 0 THEN RAISE EXCEPTION 'PERMIT_RETRY_ALREADY_USED'; END IF;
  SELECT count(*) INTO matched FROM public."WebhookEvent" WHERE "vendorId" = ${literal(target.vendorId)} AND "provider" = 'payuni';
  IF matched <> 0 THEN RAISE EXCEPTION 'PERMIT_RETRY_CALLBACK_EXISTS'; END IF;
  SELECT count(*) INTO matched FROM public."VendorSubscription"
    WHERE "vendorId" = ${literal(target.vendorId)} AND "status" = 'pending_payment' AND "id" <> acknowledged_subscription_id;
  IF matched <> 0 THEN RAISE EXCEPTION 'PERMIT_RETRY_PENDING_SUBSCRIPTION_EXISTS'; END IF;
` : "";
  const descriptionPredicate = retry ? `plan."description" = original_permit_text` : `plan."description" IS NULL`;
  const updatePredicate = retry ? `"description" = original_permit_text` : `"description" IS NULL`;
  return `${prefix}
  -- Require the dedicated owner to have exactly one active membership in
  -- exactly one vendor. Unique email/slug constraints protect both identities.
  SELECT count(*) INTO matched FROM public."Vendor" AS vendor
    JOIN public."VendorMember" AS member ON member."vendorId" = vendor."id"
    JOIN public."User" AS owner ON owner."id" = member."userId"
    WHERE vendor."id" = ${literal(target.vendorId)}
      AND vendor."slug" = ${literal(TEST_SLUG)} AND vendor."email" = ${literal(TEST_EMAIL)}
      AND owner."email" = ${literal(TEST_EMAIL)}
      AND member."role" = 'owner' AND member."status" = 'active';
  IF matched <> 1 THEN RAISE EXCEPTION 'PERMIT_VENDOR_IDENTITY_INVALID'; END IF;
  SELECT count(*) INTO matched FROM public."VendorMember"
    WHERE "vendorId" = ${literal(target.vendorId)};
  IF matched <> 1 THEN RAISE EXCEPTION 'PERMIT_VENDOR_MEMBERSHIP_INVALID'; END IF;
  SELECT count(*) INTO matched FROM public."VendorMember"
    WHERE "userId" = (SELECT "id" FROM public."User" WHERE "email" = ${literal(TEST_EMAIL)});
  IF matched <> 1 THEN RAISE EXCEPTION 'PERMIT_OWNER_MEMBERSHIP_INVALID'; END IF;

  PERFORM 1 FROM public."BillingPlan" WHERE "code" IN (${codesSql()}) FOR UPDATE;
${retryGuards}
  SELECT count(*) INTO matched FROM public."BillingPlan" AS plan
    JOIN (VALUES ${expectedPlans}) AS expected(code, cents)
      ON expected.code = plan."code"
    WHERE plan."monthlyPriceCents" = expected.cents
      AND plan."isActive" = false AND ${descriptionPredicate};
  IF matched <> 3 THEN RAISE EXCEPTION 'PERMIT_TEST_PLANS_INVALID'; END IF;
  SELECT count(*) INTO matched FROM public."BillingPlan"
    WHERE "code" IN ('starter', 'growth', 'team-pro') AND "isActive" = true;
  IF matched <> 3 THEN RAISE EXCEPTION 'PERMIT_ORIGINAL_PLANS_INVALID'; END IF;
  SELECT count(*) INTO matched FROM public."PaymentTransaction"
    WHERE "vendorId" = ${literal(target.vendorId)} AND "providerName" = 'payuni'
      AND "paymentMode" = 'platform' AND "status" = 'pending'${retry ? ` AND "id" <> ${literal(PAYUNI_STAGING_RETRY_TRANSACTION_ID)}` : ""};
  IF matched <> 0 THEN RAISE EXCEPTION 'PERMIT_PENDING_PAYMENT_EXISTS'; END IF;

  -- Construct the runtime permit in the DB so all three rows receive one
  -- identical expiry based on the same database transaction timestamp.
  permit_text := ${literal(PAYUNI_STAGING_PLAN_PERMIT_PREFIX)} || pg_catalog.jsonb_build_object(
    'deploymentHost', ${literal(target.host)},
    'merchantId', ${literal(target.merchantId)},
    'vendorId', ${literal(target.vendorId)},
    'expiresAt', CURRENT_TIMESTAMP + interval '${retry ? "30 minutes" : "2 hours"}'${retry ? `,
    'retryAttemptId', pg_catalog.gen_random_uuid()::text,
    'acknowledgedPendingTransactionId', ${literal(PAYUNI_STAGING_RETRY_TRANSACTION_ID)}` : ""}
  )::text;
  UPDATE public."BillingPlan" SET "description" = permit_text,
    "isActive" = false, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "code" IN (${codesSql()}) AND ${updatePredicate} AND "isActive" = false;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 3 THEN RAISE EXCEPTION 'PERMIT_ENABLE_COUNT_INVALID'; END IF;
  SELECT count(*) INTO matched FROM public."BillingPlan" AS plan
    JOIN (VALUES ${expectedPlans}) AS expected(code, cents)
      ON expected.code = plan."code"
    WHERE plan."monthlyPriceCents" = expected.cents
      AND plan."isActive" = false AND plan."description" = permit_text;
  IF matched <> 3 THEN RAISE EXCEPTION 'PERMIT_ENABLE_VERIFICATION_FAILED'; END IF;
END
$staging_payuni_permit$;
COMMIT;`;
}

// CLI failures may contain SQL or credentials. Only return fixed classifications,
// never the child output or an arbitrary error code extracted from it.
export function permitChildFailure(result: { error?: unknown; stdout?: string | null; stderr?: string | null }) {
  const errorCode = result.error && typeof result.error === "object" && "code" in result.error
    ? result.error.code : undefined;
  if (errorCode === "ENOENT") return "PERMIT_CLI_NOT_FOUND";
  if (errorCode === "ETIMEDOUT") return "PERMIT_CLI_TIMEOUT";
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const guards = [
    "PERMIT_PENDING_PAYMENT_EXISTS", "PERMIT_TEST_PLANS_INVALID", "PERMIT_ORIGINAL_PLANS_INVALID",
    "PERMIT_VENDOR_IDENTITY_INVALID", "PERMIT_VENDOR_MEMBERSHIP_INVALID", "PERMIT_OWNER_MEMBERSHIP_INVALID",
    "PERMIT_ISOLATION_INVALID", "PERMIT_ENABLE_COUNT_INVALID", "PERMIT_ENABLE_VERIFICATION_FAILED",
    "PERMIT_DISABLE_COUNT_INVALID", "PERMIT_DISABLE_VERIFICATION_FAILED",
    "PERMIT_RETRY_OLD_PAYMENT_INVALID", "PERMIT_RETRY_OLD_PERMIT_INVALID", "PERMIT_RETRY_ALREADY_USED",
    "PERMIT_RETRY_CALLBACK_EXISTS", "PERMIT_RETRY_PENDING_SUBSCRIPTION_EXISTS",
  ];
  for (const code of guards) {
    if (new RegExp(`\\b${code}\\b`, "u").test(output)) return code;
  }
  if (/unauthorized|forbidden|\b(?:401|403)\b|access token.*(?:missing|invalid|not provided)/iu.test(output)) {
    return "PERMIT_CLI_AUTH_FAILED";
  }
  if (/SQLSTATE[ :]+(?:40001|40P01|55P03|57014)\b/iu.test(output)) return "PERMIT_DATABASE_BUSY";
  return "PERMIT_CHILD_FAILED";
}

function checkedChild(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd, env, shell: false, windowsHide: true, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  // SQL and CLI output stay in memory and are never copied to console/logs.
  if (result.error || result.status !== 0) throw new Error(permitChildFailure(result));
  return result.stdout.trim();
}

export function runPermit(args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (args.length !== 1 || !["--enable", "--enable-retry", "--disable"].includes(args[0])) {
    throw new Error("PERMIT_MODE_INVALID");
  }
  const mode: PermitMode = args[0] === "--enable-retry" ? "enable-retry" : args[0] === "--enable" ? "enable" : "disable";
  assertPermitEnvironment(env, mode);
  assertLinkedStagingProject();
  if (process.platform !== "win32") throw new Error("PERMIT_PLATFORM_INVALID");
  const safeCliEnv = sanitizedCliEnvironment(env);
  if (checkedChild("supabase.exe", ["--version"], MAIN_WORKSPACE, safeCliEnv) !== "2.108.0") {
    throw new Error("PERMIT_CLI_VERSION_INVALID");
  }
  const sql = mode !== "disable"
    ? buildPermitSql(mode, {
      vendorId: env.PAYUNI_STAGING_PLAN_TEST_VENDOR_ID!,
      host: env.PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST!,
      merchantId: env.PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID!,
    })
    : buildPermitSql("disable");

  const sid = currentUserSid();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "celebratedeal-staging-permit-"));
  const sqlFile = path.join(tempDir, "permit.sql");
  let createdFile = false;
  let operationError: unknown;
  try {
    restrictToCurrentUser(tempDir, sid, true);
    closeSync(openSync(sqlFile, "wx", 0o600));
    createdFile = true;
    restrictToCurrentUser(sqlFile, sid, false);
    writeFileSync(sqlFile, sql, { encoding: "utf8", flag: "w" });
    checkedChild("supabase.exe", ["--workdir", MAIN_WORKSPACE, "db", "query", "--linked",
      "--profile", STAGING_PROFILE, "--file", sqlFile], MAIN_WORKSPACE, safeCliEnv);
  } catch (error) {
    operationError = error;
  } finally {
    try {
      if (createdFile) unlinkSync(sqlFile);
      rmdirSync(tempDir);
    } catch {
      throw new Error("PERMIT_TEMP_CLEANUP_FAILED");
    }
  }
  if (operationError) throw operationError;
}

if (process.argv[1]?.endsWith("staging-payuni-management-permit.ts")) {
  try {
    runPermit(process.argv.slice(2));
    process.stdout.write("STAGING_PAYUNI_PERMIT_OK\n");
  } catch (error) {
    const code = error instanceof Error && /^PERMIT_[A-Z_]+$|^LINKED_PROJECT_INVALID$/u.test(error.message)
      ? error.message : "STAGING_PAYUNI_PERMIT_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
