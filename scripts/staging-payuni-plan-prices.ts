import { Prisma, PrismaClient } from "@prisma/client";
import { getStagingDatabaseIdentityReport, isStagingDatabaseUrl, isStagingPayUniPreviewCandidate } from "../src/lib/database-identity";
import {
  PAYUNI_STAGING_APP_ORIGIN,
  PAYUNI_STAGING_PLAN_PERMIT_PREFIX,
  PAYUNI_STAGING_PLAN_PRICES_CENTS,
} from "../src/lib/payuni-staging-plan-test";

const BASE_CODES = ["starter", "growth", "team-pro"] as const;
const TEST_CODES = BASE_CODES.map((code) => `staging-payuni-${code}`);
type Mode = "inspect" | "prepare" | "enable" | "disable";

function modeFromArgs(args: string[]): Mode {
  if (args.length === 0 || (args.length === 1 && args[0] === "--inspect")) return "inspect";
  if (args.length === 1 && ["--prepare", "--enable", "--disable"].includes(args[0])) return args[0].slice(2) as Mode;
  throw new Error("Use --inspect, --prepare, --enable or --disable exactly once.");
}

export function validateTarget(env: NodeJS.ProcessEnv, mode: Mode) {
  const report = getStagingDatabaseIdentityReport(env);
  let sessionConnection = false;
  try {
    const url = new URL(env.STAGING_DATABASE_URL ?? "");
    sessionConnection = url.port === "5432" || url.port === "";
  } catch { /* The common guard returns a generic error without exposing a URL. */ }
  if (mode === "disable") {
    // Revocation must work even if unrelated runtime settings drift.
    if (!isStagingDatabaseUrl(env.STAGING_DATABASE_URL) || !sessionConnection) {
      throw new Error("The staging database revocation target is not verified.");
    }
    return;
  }
  if (env.VERCEL_ENV !== "preview"
    || env.NEXT_PUBLIC_APP_URL !== PAYUNI_STAGING_APP_ORIGIN
    || !report.all_passed
    || !isStagingDatabaseUrl(env.STAGING_DATABASE_URL)
    || !sessionConnection
    || !env.PAYUNI_STAGING_PLAN_TEST_VENDOR_ID?.trim()) {
    throw new Error("Isolated staging target is not verified.");
  }
  if (mode !== "inspect" && env.STAGING_PAYUNI_TEST_CHANGE_APPROVED !== "true") {
    throw new Error("Staging test plan mutation requires reviewed isolation and recovery evidence.");
  }
  if (mode === "enable") {
    const host = env.PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST ?? "";
    const merchantId = env.PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID ?? "";
    if (!isStagingPayUniPreviewCandidate(env)
      || !/^[-a-z0-9.]+\.vercel\.app$/.test(host)
      || !/^[A-Za-z0-9_-]{4,64}$/.test(merchantId)) {
      throw new Error("A reviewed deployment host and merchant ID are required.");
    }
  }
}

function permitDescription(env: NodeJS.ProcessEnv) {
  return PAYUNI_STAGING_PLAN_PERMIT_PREFIX + JSON.stringify({
    deploymentHost: env.PAYUNI_STAGING_PLAN_TEST_DEPLOYMENT_HOST,
    merchantId: env.PAYUNI_STAGING_PLAN_TEST_MERCHANT_ID,
    vendorId: env.PAYUNI_STAGING_PLAN_TEST_VENDOR_ID,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
}

/** Creates inactive test-only copies. Original plan rows are never updated. */
export async function runStagingPlanPriceChange(db: PrismaClient, env: NodeJS.ProcessEnv, mode: Mode) {
  return db.$transaction(async (tx) => {
    const tests = await tx.billingPlan.findMany({ where: { code: { in: TEST_CODES } } });
    if (mode === "disable") {
      for (const plan of tests) {
        if (plan.description?.startsWith(PAYUNI_STAGING_PLAN_PERMIT_PREFIX) || plan.isActive) {
          await tx.billingPlan.update({ where: { id: plan.id }, data: { description: null, isActive: false } });
        }
      }
      return { mode, changed: tests.filter((plan) => plan.description?.startsWith(PAYUNI_STAGING_PLAN_PERMIT_PREFIX) || plan.isActive).length, found: tests.length, anomalous: tests.filter((plan) => plan.isActive || plan.monthlyPriceCents !== PAYUNI_STAGING_PLAN_PRICES_CENTS[plan.code as keyof typeof PAYUNI_STAGING_PLAN_PRICES_CENTS]).length };
    }
    const originals = await tx.billingPlan.findMany({ where: { code: { in: [...BASE_CODES] }, isActive: true } });
    if (originals.length !== 3) throw new Error("Original staging plans are incomplete.");
    const vendor = await tx.vendor.findUnique({ where: { id: env.PAYUNI_STAGING_PLAN_TEST_VENDOR_ID! }, select: { id: true } });
    if (!vendor) throw new Error("Designated staging test vendor was not found.");
    if (tests.some((plan) => plan.isActive
      || plan.monthlyPriceCents !== PAYUNI_STAGING_PLAN_PRICES_CENTS[plan.code as keyof typeof PAYUNI_STAGING_PLAN_PRICES_CENTS])) {
      throw new Error("A test plan is active or has an unexpected amount.");
    }
    if (mode === "inspect") return { mode, originalPrices: originals.map((p) => ({ code: p.code, cents: p.monthlyPriceCents })), testPrices: tests.map((p) => ({ code: p.code, cents: p.monthlyPriceCents, permitPresent: p.description?.startsWith(PAYUNI_STAGING_PLAN_PERMIT_PREFIX) ?? false })) };
    if (mode === "prepare") {
      if (tests.length > 0 && tests.length !== 3) throw new Error("Partial test plans require manual reconciliation.");
      if (tests.length === 0) {
        for (const code of BASE_CODES) {
          const source = originals.find((p) => p.code === code)!;
          const testCode = `staging-payuni-${code}` as keyof typeof PAYUNI_STAGING_PLAN_PRICES_CENTS;
          await tx.billingPlan.create({ data: {
            name: source.name,
            code: testCode,
            monthlyPriceCents: PAYUNI_STAGING_PLAN_PRICES_CENTS[testCode],
            includedStreamMinutes: source.includedStreamMinutes,
            includedStorageMinutes: source.includedStorageMinutes,
            includedCredits: source.includedCredits,
            includedEvents: source.includedEvents,
            includedAffiliates: source.includedAffiliates,
            overageCreditCostCents: source.overageCreditCostCents,
            overflowWatchHourPriceCents: source.overflowWatchHourPriceCents,
            overflowEventUnitPriceCents: source.overflowEventUnitPriceCents,
            overflowAffiliateUnitPriceCents: source.overflowAffiliateUnitPriceCents,
            overflowStorageMinutePriceCents: source.overflowStorageMinutePriceCents,
            paymentServiceFeeCents: source.paymentServiceFeeCents,
            transactionFeeRateBps: source.transactionFeeRateBps,
            affiliateManagementFeeCents: source.affiliateManagementFeeCents,
            isActive: false,
            description: null,
          } });
        }
      }
      return { mode, changed: tests.length === 0 ? 3 : 0 };
    }
    if (tests.length !== 3) throw new Error("Prepare all three inactive test plans first.");
    const pendingPayments = await tx.paymentTransaction.count({ where: {
      vendorId: vendor.id,
      providerName: "payuni",
      paymentMode: "platform",
      status: "pending",
    } });
    if (pendingPayments > 0) throw new Error("Reconcile pending PAYUNi platform payments before changing the permit.");
    // A DB-held permit revokes every immutable Preview URL immediately. The
    // generated deployment host limits activation to the reviewed build.
    const description = mode === "enable" ? permitDescription(env) : null;
    for (const plan of tests) {
      await tx.billingPlan.update({ where: { id: plan.id }, data: { description } });
    }
    return { mode, changed: 3 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function main() {
  const mode = modeFromArgs(process.argv.slice(2));
  validateTarget(process.env, mode);
  const db = new PrismaClient({ datasources: { db: { url: process.env.STAGING_DATABASE_URL } }, log: [] });
  try {
    const result = await runStagingPlanPriceChange(db, process.env, mode);
    // Public plan amounts only; never print URLs, merchant IDs, vendor IDs or secrets.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("staging-payuni-plan-prices.ts")) {
  main().catch(() => {
    process.stderr.write("Staging test plan operation did not pass its safety checks.\n");
    process.exitCode = 1;
  });
}
