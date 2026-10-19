/**
 * Deployment topology checks for F-090 (B06-03): function region, database
 * region and Prisma pooler parameters.
 *
 * Every check is advisory: it returns "warning" instead of "fail" so a build is
 * never blocked by topology, and messages only contain fixed words and public
 * region IDs. Database hosts, credentials and query values are never echoed.
 *
 * The function region is configuration, not code. The Vercel config file that
 * preflight reads (`regions`) is authoritative because Vercel lets it override
 * the dashboard; `EXPECTED_FUNCTION_REGION` only verifies it and never replaces
 * it (PR #447 review m2). Without a `regions` entry the env value is the best
 * available description of the dashboard setting.
 */

export type TopologyCheck = {
  key: string;
  status: "pass" | "warning";
  message: string;
};

type EnvironmentValues = Partial<Record<string, string | undefined>>;

/** Vercel function region -> closest AWS region (Supabase projects run on AWS). */
export const VERCEL_REGION_TO_AWS_REGION: Readonly<Record<string, string>> = Object.freeze({
  arn1: "eu-north-1",
  bom1: "ap-south-1",
  cdg1: "eu-west-3",
  cle1: "us-east-2",
  cpt1: "af-south-1",
  dub1: "eu-west-1",
  fra1: "eu-central-1",
  gru1: "sa-east-1",
  hkg1: "ap-east-1",
  hnd1: "ap-northeast-1",
  iad1: "us-east-1",
  icn1: "ap-northeast-2",
  kix1: "ap-northeast-3",
  lhr1: "eu-west-2",
  pdx1: "us-west-2",
  sfo1: "us-west-1",
  sin1: "ap-southeast-1",
  syd1: "ap-southeast-2",
});

const VERCEL_REGION_ID = /^[a-z]{3}\d$/u;
const AWS_REGION_ID = /^[a-z]{2}-[a-z]+-\d$/u;
const SUPABASE_POOLER_HOST = /^aws-\d+-([a-z]{2}-[a-z]+-\d)\.pooler\.supabase\.com$/u;
const SUPABASE_TRANSACTION_POOLER_PORT = "6543";
const CONNECTION_LIMIT_RANGE = { min: 1, max: 100 } as const;

export function topologyChecksApplicable(env: EnvironmentValues) {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

export function normalizeVercelRegion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const region = value.trim().toLowerCase();
  return VERCEL_REGION_ID.test(region) ? region : null;
}

/** Reads `regions[0]` from a parsed vercel.json-like object. */
export function configuredVercelRegion(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const regions = (config as { regions?: unknown }).regions;
  if (!Array.isArray(regions) || regions.length !== 1) return null;
  return normalizeVercelRegion(regions[0]);
}

/** Infers the AWS region of a Supabase pooler URL without returning the host. */
export function supabasePoolerAwsRegion(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const match = SUPABASE_POOLER_HOST.exec(new URL(databaseUrl).hostname.toLowerCase());
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function databaseRegion(env: EnvironmentValues): string | null {
  const declared = env.DATABASE_REGION?.trim().toLowerCase();
  if (declared && AWS_REGION_ID.test(declared)) return declared;
  return supabasePoolerAwsRegion(env.DATABASE_URL);
}

export function getDatabasePoolerChecks(databaseUrl: string | undefined): TopologyCheck[] {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? "");
  } catch {
    // ProductionEnvSchema already fails a missing or malformed DATABASE_URL.
    return [];
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") return [];

  const checks: TopologyCheck[] = [];
  const transactionPooler = url.port === SUPABASE_TRANSACTION_POOLER_PORT;
  checks.push(transactionPooler
    ? { key: "DATABASE_POOLER", status: "pass", message: "DATABASE_URL 使用 transaction pooler（6543）" }
    : { key: "DATABASE_POOLER", status: "warning", message: "DATABASE_URL 不是 6543 transaction pooler；serverless 多實例時容易耗盡直連連線" });

  if (transactionPooler) {
    const pgbouncer = url.searchParams.get("pgbouncer");
    checks.push(pgbouncer === "true"
      ? { key: "DATABASE_POOLER_PGBOUNCER", status: "pass", message: "已設定 pgbouncer=true" }
      : { key: "DATABASE_POOLER_PGBOUNCER", status: "warning", message: "6543 pooler 需要 pgbouncer=true，否則 Prisma prepared statement 會與 transaction mode 衝突" });
  }

  const limitValue = url.searchParams.get("connection_limit");
  const limit = limitValue !== null && /^\d{1,3}$/u.test(limitValue) ? Number(limitValue) : null;
  checks.push(limit !== null && limit >= CONNECTION_LIMIT_RANGE.min && limit <= CONNECTION_LIMIT_RANGE.max
    ? { key: "DATABASE_CONNECTION_LIMIT", status: "pass", message: `connection_limit=${limit}` }
    : { key: "DATABASE_CONNECTION_LIMIT", status: "warning", message: "未設定有效的 connection_limit（1–100）；建議從 3–5 起，依負載測試調整" });

  return checks;
}

export function getRegionAlignmentChecks(env: EnvironmentValues, configuredRegion: string | null): TopologyCheck[] {
  const checks: TopologyCheck[] = [];
  const declared = normalizeVercelRegion(env.EXPECTED_FUNCTION_REGION);
  const expected = configuredRegion ?? declared;
  const runtime = normalizeVercelRegion(env.VERCEL_REGION);

  if (!expected) {
    checks.push({ key: "FUNCTION_REGION", status: "warning", message: "未設定函式區域（vercel 設定的 regions 或 EXPECTED_FUNCTION_REGION）；Vercel 會用預設區域" });
  } else if (configuredRegion && declared && declared !== configuredRegion) {
    checks.push({ key: "FUNCTION_REGION", status: "warning", message: `EXPECTED_FUNCTION_REGION ${declared} 與 Vercel 設定 regions ${configuredRegion} 不一致；實際以 Vercel 設定為準，要換區域必須改設定檔` });
  } else {
    checks.push({ key: "FUNCTION_REGION", status: "pass", message: `預期函式區域 ${expected}` });
  }

  // VERCEL_REGION is injected at function runtime; builds usually do not have it.
  if (runtime) {
    checks.push(expected && runtime !== expected
      ? { key: "VERCEL_REGION", status: "warning", message: `實際區域 ${runtime} 與預期 ${expected} 不同` }
      : { key: "VERCEL_REGION", status: "pass", message: `實際區域 ${runtime}` });
  }

  const dbRegion = databaseRegion(env);
  const functionRegion = runtime ?? expected;
  if (!dbRegion) {
    checks.push({ key: "DATABASE_REGION", status: "warning", message: "無法判斷資料庫區域；請設定 DATABASE_REGION（例如 ap-northeast-1）或使用 Supabase pooler 網址" });
  } else if (!functionRegion) {
    checks.push({ key: "DATABASE_REGION", status: "pass", message: `資料庫區域 ${dbRegion}` });
  } else {
    const functionAwsRegion = VERCEL_REGION_TO_AWS_REGION[functionRegion];
    checks.push(functionAwsRegion === dbRegion
      ? { key: "DATABASE_REGION", status: "pass", message: `函式 ${functionRegion} 與資料庫 ${dbRegion} 同區` }
      : { key: "DATABASE_REGION", status: "warning", message: `函式 ${functionRegion} 與資料庫 ${dbRegion} 跨區；每次資料庫往返都會增加延遲` });
  }

  return checks;
}

/**
 * GET (Vercel Cron) and POST (job runner) entries only stay separated when the
 * two bearer secrets differ (PR #447 review n2). Values are never echoed.
 */
export function getSchedulerSecretChecks(env: EnvironmentValues): TopologyCheck[] {
  const cron = env.CRON_SECRET?.trim();
  const job = env.JOB_SECRET?.trim();
  if (!cron || !job) return [];
  return [cron === job
    ? { key: "SCHEDULER_SECRET_SEPARATION", status: "warning", message: "CRON_SECRET 與 JOB_SECRET 相同；GET／POST 排程入口的密鑰分離失效" }
    : { key: "SCHEDULER_SECRET_SEPARATION", status: "pass", message: "CRON_SECRET 與 JOB_SECRET 不同" }];
}

/** Only these checked-in files may be named by VERCEL_CONFIG_FILE (PR #447 review n1). */
export const VERCEL_CONFIG_FILES: readonly string[] = Object.freeze(["vercel.json", "vercel.staging.json"]);

export function selectVercelConfigFile(env: EnvironmentValues) {
  const requested = env.VERCEL_CONFIG_FILE?.trim();
  return requested && VERCEL_CONFIG_FILES.includes(requested) ? requested : "vercel.json";
}

export function getDeploymentTopologyChecks(env: EnvironmentValues, vercelConfig?: unknown): TopologyCheck[] {
  if (!topologyChecksApplicable(env)) return [];
  return [
    ...getRegionAlignmentChecks(env, configuredVercelRegion(vercelConfig)),
    ...getDatabasePoolerChecks(env.DATABASE_URL),
    ...getSchedulerSecretChecks(env),
  ];
}
