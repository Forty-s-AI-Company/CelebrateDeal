import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, lstatSync, mkdtempSync, openSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashPasswordAsync } from "../src/lib/password";
import { PAYUNI_STAGING_APP_ORIGIN, PAYUNI_STAGING_PLAN_PRICES_CENTS } from "../src/lib/payuni-staging-plan-test";

// This adapter only prepares the fixed isolated staging fixture. It cannot
// activate payments, accept arbitrary SQL, or select a different project.
const MAIN_WORKSPACE = "C:\\Users\\eden\\Downloads\\AI\\CelebrateDeal";
const STAGING_PROJECT_REF = "ocbugvgojrunvenozsbx";
const STAGING_PROFILE = "celebratedeal-staging-20261002";
const STAGING_VERCEL_PROJECT_ID = "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn";
const STAGING_BRANCH = "codex/prelaunch-engineering-20260929";
const TEST_VENDOR_SLUG = "payuni-plan-test";
const TEST_ACCOUNT_EMAIL = "zeroyuanbrothers@gmail.com";
const TEST_ACCOUNT_NAME = "Staging PAYUNi Test Owner";
const TEST_VENDOR_NAME = "PAYUNi Staging Plan Test";
const PLAN_CODES = Object.keys(PAYUNI_STAGING_PLAN_PRICES_CENTS) as Array<keyof typeof PAYUNI_STAGING_PLAN_PRICES_CENTS>;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/u;

export type PrepareInput = {
  vendorId: string;
  userId: string;
  trackingId: string;
  memberId: string;
  auditId: string;
  planIds: Record<keyof typeof PAYUNI_STAGING_PLAN_PRICES_CENTS, string>;
  vendorPasswordHash: string;
  userPasswordHash: string;
};

// Only generated UUIDs and scrypt hashes enter SQL. Escaping is kept here as
// defense in depth; the adapter has no caller-supplied SQL or account fields.
function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildPrepareSql(input: PrepareInput) {
  const ids = [input.vendorId, input.userId, input.trackingId, input.memberId, input.auditId, ...PLAN_CODES.map((code) => input.planIds[code])];
  if (ids.some((id) => !ID_PATTERN.test(id)) || new Set(ids).size !== 8
    || !HASH_PATTERN.test(input.vendorPasswordHash)
    || !HASH_PATTERN.test(input.userPasswordHash)
    || input.vendorPasswordHash === input.userPasswordHash) {
    throw new Error("PREPARE_INPUT_INVALID");
  }

  const planValues = PLAN_CODES.map((code) => {
    const baseCode = code.slice("staging-payuni-".length);
    return `(${sqlLiteral(baseCode)}, ${sqlLiteral(code)}, ${PAYUNI_STAGING_PLAN_PRICES_CENTS[code]}, ${sqlLiteral(input.planIds[code])})`;
  }).join(",\n      ");

  // One Management API query contains the complete transaction. Every
  // exception aborts all eight inserts; no original plan is updated.
  return `BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';
DO $staging_payuni_prepare$
DECLARE
  affected integer;
  matched integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(351, 20261003);
  IF current_setting('transaction_isolation') <> 'serializable' THEN
    RAISE EXCEPTION 'PREPARE_ISOLATION_INVALID';
  END IF;

  SELECT count(*) INTO matched FROM public."Vendor"
    WHERE "slug" = ${sqlLiteral(TEST_VENDOR_SLUG)} OR "email" = ${sqlLiteral(TEST_ACCOUNT_EMAIL)};
  IF matched <> 0 THEN RAISE EXCEPTION 'PREPARE_VENDOR_EXISTS'; END IF;
  SELECT count(*) INTO matched FROM public."User" WHERE "email" = ${sqlLiteral(TEST_ACCOUNT_EMAIL)};
  IF matched <> 0 THEN RAISE EXCEPTION 'PREPARE_USER_EXISTS'; END IF;
  SELECT count(*) INTO matched FROM public."BillingPlan"
    WHERE "code" IN (${PLAN_CODES.map(sqlLiteral).join(", ")});
  IF matched <> 0 THEN RAISE EXCEPTION 'PREPARE_TEST_PLANS_EXIST'; END IF;

  -- Lock the three active source rows for the duration of the copy.
  PERFORM 1 FROM public."BillingPlan"
    WHERE "code" IN ('starter', 'growth', 'team-pro') AND "isActive" = true FOR SHARE;
  SELECT count(*) INTO matched FROM public."BillingPlan"
    WHERE "code" IN ('starter', 'growth', 'team-pro') AND "isActive" = true;
  IF matched <> 3 THEN RAISE EXCEPTION 'PREPARE_ORIGINAL_PLANS_INVALID'; END IF;

  INSERT INTO public."Vendor" ("id", "name", "slug", "email", "passwordHash", "updatedAt")
    VALUES (${sqlLiteral(input.vendorId)}, ${sqlLiteral(TEST_VENDOR_NAME)}, ${sqlLiteral(TEST_VENDOR_SLUG)}, ${sqlLiteral(TEST_ACCOUNT_EMAIL)}, ${sqlLiteral(input.vendorPasswordHash)}, CURRENT_TIMESTAMP);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'PREPARE_VENDOR_COUNT'; END IF;

  INSERT INTO public."TrackingSetting" ("id", "vendorId", "updatedAt")
    VALUES (${sqlLiteral(input.trackingId)}, ${sqlLiteral(input.vendorId)}, CURRENT_TIMESTAMP);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'PREPARE_TRACKING_COUNT'; END IF;

  INSERT INTO public."User" ("id", "email", "name", "passwordHash", "status", "updatedAt")
    VALUES (${sqlLiteral(input.userId)}, ${sqlLiteral(TEST_ACCOUNT_EMAIL)}, ${sqlLiteral(TEST_ACCOUNT_NAME)}, ${sqlLiteral(input.userPasswordHash)}, 'active', CURRENT_TIMESTAMP);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'PREPARE_USER_COUNT'; END IF;

  INSERT INTO public."VendorMember" ("id", "vendorId", "userId", "role", "status", "updatedAt")
    VALUES (${sqlLiteral(input.memberId)}, ${sqlLiteral(input.vendorId)}, ${sqlLiteral(input.userId)}, 'owner', 'active', CURRENT_TIMESTAMP);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'PREPARE_MEMBER_COUNT'; END IF;

  INSERT INTO public."AuditLog" ("id", "vendorId", "actorLabel", "action", "targetType", "targetId", "after")
    VALUES (${sqlLiteral(input.auditId)}, ${sqlLiteral(input.vendorId)}, 'staging-bootstrap',
      'create_staging_payuni_test_vendor', 'Vendor', ${sqlLiteral(input.vendorId)},
      pg_catalog.jsonb_build_object('userId', ${sqlLiteral(input.userId)}, 'purpose', 'payuni-staging-plan-test'));
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'PREPARE_AUDIT_COUNT'; END IF;

  INSERT INTO public."BillingPlan" (
    "id", "name", "code", "monthlyPriceCents", "includedStreamMinutes",
    "includedStorageMinutes", "includedCredits", "includedEvents", "includedAffiliates",
    "overageCreditCostCents", "overflowWatchHourPriceCents", "overflowEventUnitPriceCents",
    "overflowAffiliateUnitPriceCents", "overflowStorageMinutePriceCents",
    "paymentServiceFeeCents", "transactionFeeRateBps", "affiliateManagementFeeCents",
    "isActive", "description", "updatedAt"
  )
  SELECT fixture.plan_id, source."name", fixture.test_code, fixture.price_cents,
    source."includedStreamMinutes", source."includedStorageMinutes", source."includedCredits",
    source."includedEvents", source."includedAffiliates", source."overageCreditCostCents",
    source."overflowWatchHourPriceCents", source."overflowEventUnitPriceCents",
    source."overflowAffiliateUnitPriceCents", source."overflowStorageMinutePriceCents",
    source."paymentServiceFeeCents", source."transactionFeeRateBps",
    source."affiliateManagementFeeCents", false, NULL, CURRENT_TIMESTAMP
  FROM (VALUES
      ${planValues}
    ) AS fixture(base_code, test_code, price_cents, plan_id)
  JOIN public."BillingPlan" AS source ON source."code" = fixture.base_code AND source."isActive" = true;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 3 THEN RAISE EXCEPTION 'PREPARE_PLAN_COUNT'; END IF;

  SELECT count(*) INTO matched FROM public."Vendor" AS vendor
    JOIN public."TrackingSetting" AS tracking ON tracking."vendorId" = vendor."id"
    JOIN public."VendorMember" AS member ON member."vendorId" = vendor."id"
    JOIN public."User" AS owner ON owner."id" = member."userId"
    JOIN public."AuditLog" AS audit ON audit."vendorId" = vendor."id"
    WHERE vendor."id" = ${sqlLiteral(input.vendorId)} AND vendor."slug" = ${sqlLiteral(TEST_VENDOR_SLUG)}
      AND vendor."email" = ${sqlLiteral(TEST_ACCOUNT_EMAIL)}
      AND owner."id" = ${sqlLiteral(input.userId)} AND owner."email" = ${sqlLiteral(TEST_ACCOUNT_EMAIL)}
      AND member."role" = 'owner' AND member."status" = 'active'
      AND audit."id" = ${sqlLiteral(input.auditId)}
      AND audit."action" = 'create_staging_payuni_test_vendor';
  IF matched <> 1 THEN RAISE EXCEPTION 'PREPARE_RELATIONS_INVALID'; END IF;
  SELECT count(*) INTO matched FROM public."BillingPlan" AS plan
    JOIN (VALUES
      ${planValues}
    ) AS fixture(base_code, test_code, price_cents, plan_id)
      ON plan."id" = fixture.plan_id AND plan."code" = fixture.test_code
    WHERE plan."monthlyPriceCents" = fixture.price_cents
      AND plan."isActive" = false AND plan."description" IS NULL;
  IF matched <> 3 THEN RAISE EXCEPTION 'PREPARE_PLAN_VERIFICATION_FAILED'; END IF;
END
$staging_payuni_prepare$;
COMMIT;`;
}

export function assertLinkedStagingProject(workspace = MAIN_WORKSPACE) {
  // Read only the CLI's non-secret linked project identifier. Never inspect its
  // profile credentials, database password, or a dotenv file.
  const refFile = path.join(workspace, "supabase", ".temp", "project-ref");
  const info = lstatSync(refFile);
  if (!info.isFile() || info.isSymbolicLink() || readFileSync(refFile, "utf8").trim() !== STAGING_PROJECT_REF) {
    throw new Error("LINKED_PROJECT_INVALID");
  }
}

export function assertPrepareEnvironment(env: NodeJS.ProcessEnv) {
  if (env.STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED !== "true"
    || env.STAGING_PAYUNI_TEST_CHANGE_APPROVED !== "true"
    || env.STAGING_PAYUNI_TEST_ACCOUNT_EMAIL?.trim().toLowerCase() !== TEST_ACCOUNT_EMAIL
    || env.PAYUNI_STAGING_PLAN_TEST_ENABLED !== "false"
    || env.VERCEL_ENV !== "preview"
    || env.VERCEL_PROJECT_ID !== STAGING_VERCEL_PROJECT_ID
    || env.VERCEL_GIT_COMMIT_REF !== STAGING_BRANCH
    || env.NEXT_PUBLIC_APP_URL !== PAYUNI_STAGING_APP_ORIGIN
    || env.NEXT_PUBLIC_SUPABASE_URL !== `https://${STAGING_PROJECT_REF}.supabase.co`) {
    throw new Error("PREPARE_ENVIRONMENT_INVALID");
  }
}

export function sanitizedCliEnvironment(source: NodeJS.ProcessEnv) {
  // Supabase CLI target/profile/DB overrides must not win over the fixed args.
  // The selected profile is read by the CLI itself; no credential is copied.
  return Object.fromEntries(Object.entries(source).filter(([key]) =>
    !/^SUPABASE_/iu.test(key) && !/^PG[A-Z0-9_]*$/iu.test(key)
    && key !== "DATABASE_URL" && key !== "DIRECT_URL" && key !== "STAGING_DATABASE_URL"
    && key !== "NODE_OPTIONS")) as NodeJS.ProcessEnv;
}

function checkedSpawn(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  // Suppress child output: a CLI or SQL failure may echo a hash or statement.
  if (result.error || result.status !== 0) throw new Error("PREPARE_CHILD_FAILED");
  return result.stdout.trim();
}

export function currentUserSid() {
  const output = checkedSpawn("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = output.match(/S-1-(?:\d+-)+\d+/u)?.[0];
  if (!sid) throw new Error("PREPARE_ACL_FAILED");
  return sid;
}

export function restrictToCurrentUser(target: string, sid: string, directory: boolean) {
  const grant = directory ? `*${sid}:(OI)(CI)F` : `*${sid}:F`;
  checkedSpawn("icacls.exe", [target, "/inheritance:r", "/grant:r", grant]);
}

async function generatedInput(): Promise<PrepareInput> {
  // The raw passwords are independently random and are never retained in SQL.
  const [vendorPasswordHash, userPasswordHash] = await Promise.all([
    hashPasswordAsync(randomBytes(48).toString("base64url")),
    hashPasswordAsync(randomBytes(48).toString("base64url")),
  ]);
  return {
    vendorId: randomUUID(), userId: randomUUID(), trackingId: randomUUID(),
    memberId: randomUUID(), auditId: randomUUID(),
    planIds: Object.fromEntries(PLAN_CODES.map((code) => [code, randomUUID()])) as PrepareInput["planIds"],
    vendorPasswordHash, userPasswordHash,
  };
}

export async function runPrepare(args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (args.length !== 1 || args[0] !== "--prepare") throw new Error("PREPARE_MODE_INVALID");
  assertPrepareEnvironment(env);
  assertLinkedStagingProject();
  const safeCliEnv = sanitizedCliEnvironment(env);
  if (checkedSpawn("supabase.exe", ["--version"], MAIN_WORKSPACE, safeCliEnv) !== "2.108.0") throw new Error("PREPARE_CLI_VERSION_INVALID");
  if (process.platform !== "win32") throw new Error("PREPARE_PLATFORM_INVALID");

  const sid = currentUserSid();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "celebratedeal-staging-prepare-"));
  const sqlFile = path.join(tempDir, "prepare.sql");
  let createdFile = false;
  let prepareError: unknown;
  try {
    restrictToCurrentUser(tempDir, sid, true);
    closeSync(openSync(sqlFile, "wx", 0o600));
    createdFile = true;
    restrictToCurrentUser(sqlFile, sid, false);
    writeFileSync(sqlFile, buildPrepareSql(await generatedInput()), { encoding: "utf8", flag: "w" });
    checkedSpawn("supabase.exe", ["--workdir", MAIN_WORKSPACE, "db", "query", "--linked", "--profile", STAGING_PROFILE, "--file", sqlFile], MAIN_WORKSPACE, safeCliEnv);
  } catch (error) {
    prepareError = error;
  } finally {
    try {
      if (createdFile) unlinkSync(sqlFile);
      rmdirSync(tempDir);
    } catch {
      throw new Error("PREPARE_TEMP_CLEANUP_FAILED");
    }
  }
  if (prepareError) throw prepareError;
}

if (process.argv[1]?.endsWith("staging-payuni-management-prepare.ts")) {
  runPrepare(process.argv.slice(2)).then(() => {
    process.stdout.write("STAGING_PAYUNI_PREPARE_OK\n");
  }).catch((error: unknown) => {
    // Never write CLI stderr, generated SQL, hashes, or a connection string.
    const code = error instanceof Error && /^PREPARE_[A-Z_]+$|^LINKED_PROJECT_INVALID$/u.test(error.message)
      ? error.message : "STAGING_PAYUNI_PREPARE_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
