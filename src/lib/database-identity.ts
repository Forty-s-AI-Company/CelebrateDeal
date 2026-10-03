const STAGING_SUPABASE_PROJECT_REF = "ocbugvgojrunvenozsbx";
const STAGING_SUPABASE_HOST = `${STAGING_SUPABASE_PROJECT_REF}.supabase.co`;
const STAGING_DATABASE_HOST = `db.${STAGING_SUPABASE_PROJECT_REF}.supabase.co`;
const STAGING_POOLER_USERNAME = `postgres.${STAGING_SUPABASE_PROJECT_REF}`;
const STAGING_VERCEL_PROJECT_ID = "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn";
const STAGING_APP_ORIGIN = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const STAGING_R2_BUCKET = "celebrate-deal-staging";
const STAGING_PAYMENT_TEST_BRANCH = "codex/prelaunch-engineering-20260929";

export type StagingDatabaseIdentityReport = {
  supabase_url_match: boolean;
  database_url_match: boolean;
  direct_url_match: boolean;
  staging_database_url_match: boolean | null;
  all_passed: boolean;
};

type EnvironmentValues = Record<string, string | undefined>;

function parseUrl(value: string | undefined): URL | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function matchesSupabaseUrl(value: string | undefined): boolean {
  const parsed = parseUrl(value);

  return parsed?.protocol === "https:" && parsed.hostname.toLowerCase() === STAGING_SUPABASE_HOST;
}

export function isStagingDatabaseUrl(value: string | undefined): boolean {
  const parsed = parseUrl(value);

  if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === STAGING_DATABASE_HOST) {
    return true;
  }

  try {
    const username = decodeURIComponent(parsed.username).toLowerCase();
    return hostname.endsWith(".pooler.supabase.com") && username === STAGING_POOLER_USERNAME;
  } catch {
    return false;
  }
}

/**
 * 只比對 Preview 執行期的 project ref；絕不回傳原始 URL 或密碼。
 * STAGING_DATABASE_URL 未設定時保留 null，方便區分「未設定」與「設定但指向錯誤專案」。
 */
export function getStagingDatabaseIdentityReport(
  env: EnvironmentValues = process.env,
): StagingDatabaseIdentityReport {
  const supabase_url_match = matchesSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const database_url_match = isStagingDatabaseUrl(env.DATABASE_URL);
  const direct_url_match = isStagingDatabaseUrl(env.DIRECT_URL);
  const staging_database_url_match = env.STAGING_DATABASE_URL?.trim()
    ? isStagingDatabaseUrl(env.STAGING_DATABASE_URL)
    : null;

  return {
    supabase_url_match,
    database_url_match,
    direct_url_match,
    staging_database_url_match,
    all_passed:
      supabase_url_match &&
      database_url_match &&
      direct_url_match &&
      staging_database_url_match === true,
  };
}

/** Fail the fixed staging Preview build if any application connection points elsewhere. */
export function getStagingPreviewBuildIdentityCheck(env: EnvironmentValues = process.env) {
  if (env.VERCEL_PROJECT_ID !== STAGING_VERCEL_PROJECT_ID || env.VERCEL_ENV !== "preview") {
    return { applicable: false, passed: true };
  }
  return {
    applicable: true,
    passed: env.NEXT_PUBLIC_APP_URL === STAGING_APP_ORIGIN
      && getStagingDatabaseIdentityReport(env).all_passed,
  };
}

/** Allow the isolated candidate to build before its payment flag and DB permit are enabled. */
export function isStagingPayUniPreviewCandidate(env: EnvironmentValues = process.env) {
  return env.VERCEL_PROJECT_ID === STAGING_VERCEL_PROJECT_ID
    && env.VERCEL_ENV === "preview"
    && env.VERCEL_GIT_COMMIT_REF === STAGING_PAYMENT_TEST_BRANCH
    && env.PAYMENT_PROVIDER === "payuni"
    && env.PAYUNI_LIVE_PROBE_ENABLED !== "true"
    && getStagingPreviewBuildIdentityCheck(env).passed;
}

/** Payment-only Preview must have no credentials that can modify Cloudflare media. */
export function getStagingPreviewMediaIsolationCheck(env: EnvironmentValues = process.env) {
  if (env.VERCEL_PROJECT_ID !== STAGING_VERCEL_PROJECT_ID || env.VERCEL_ENV !== "preview") {
    return { applicable: false, passed: true };
  }
  const requiresAbsentMediaCredentials = env.PAYUNI_STAGING_PLAN_TEST_ENABLED === "true"
    || env.VERCEL_GIT_COMMIT_REF === STAGING_PAYMENT_TEST_BRANCH;
  const mediaCredentialsAbsent = !env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim()
    && !env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim()
    && !env.CLOUDFLARE_ACCOUNT_ID?.trim()
    && !env.CLOUDFLARE_STREAM_TOKEN?.trim()
    && !env.CLOUDFLARE_STREAM_WEBHOOK_SECRET?.trim();
  return {
    applicable: true,
    passed: env.CLOUDFLARE_R2_BUCKET === STAGING_R2_BUCKET
      && (!requiresAbsentMediaCredentials || mediaCredentialsAbsent),
  };
}
