const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ISOLATED_DATABASE_NAME =
  /^celebratedeal_(?:dev|test|e2e|ci|wp17_ci|wp18_ci)$/i;

export const DEFAULT_LOCAL_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public";

/** The CLI preflight and Vitest must resolve the same target before connecting. */
export function resolveLocalDatabaseUrl(value: string | undefined, mode: "dev" | "test") {
  if (mode === "test" && (!value || value.startsWith("file:"))) return DEFAULT_LOCAL_TEST_DATABASE_URL;
  if (!value) {
    throw new Error("[local_database_safety] DATABASE_URL must be injected into the shell before npm run dev. This local preflight does not load .env files; see docs/launch/local-database-development.md.");
  }
  return value;
}

export type LocalDatabaseSafety =
  | { safe: true }
  | {
      safe: false;
      category: "missing" | "invalid-url" | "unsupported-protocol" | "non-loopback" | "unsafe-database";
    };

/**
 * Tests may create, update, and delete fixture data. Keep their database
 * boundary fail-closed so a changed .env.local can never redirect them to a
 * deployed environment.
 *
 * This helper intentionally returns only a safe category. It never includes
 * the URL, host, username, password, or database name in logs or exceptions.
 */
export function classifyLocalTestDatabase(value: string | undefined): LocalDatabaseSafety {
  if (!value) {
    return { safe: false, category: "missing" };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { safe: false, category: "invalid-url" };
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return { safe: false, category: "unsupported-protocol" };
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { safe: false, category: "non-loopback" };
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!ISOLATED_DATABASE_NAME.test(databaseName)) {
    return { safe: false, category: "unsafe-database" };
  }

  return { safe: true };
}

export function assertLocalTestDatabase(
  environmentName: "DATABASE_URL" | "DIRECT_URL",
  value: string | undefined,
): asserts value is string {
  const result = classifyLocalTestDatabase(value);
  if (!result.safe) {
    throw new Error(
      `[local_database_safety] ${environmentName} rejected; category=${result.category}`,
    );
  }
}
