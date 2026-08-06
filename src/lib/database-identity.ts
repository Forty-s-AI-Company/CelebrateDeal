const STAGING_SUPABASE_PROJECT_REF = "ocbugvgojrunvenozsbx";
const STAGING_SUPABASE_HOST = `${STAGING_SUPABASE_PROJECT_REF}.supabase.co`;
const STAGING_DATABASE_HOST = `db.${STAGING_SUPABASE_PROJECT_REF}.supabase.co`;
const STAGING_POOLER_USERNAME = `postgres.${STAGING_SUPABASE_PROJECT_REF}`;

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

function matchesDatabaseUrl(value: string | undefined): boolean {
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
  const database_url_match = matchesDatabaseUrl(env.DATABASE_URL);
  const direct_url_match = matchesDatabaseUrl(env.DIRECT_URL);
  const staging_database_url_match = env.STAGING_DATABASE_URL?.trim()
    ? matchesDatabaseUrl(env.STAGING_DATABASE_URL)
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
