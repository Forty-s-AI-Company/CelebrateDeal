const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const ISOLATED_DATABASE_NAME =
  /^celebratedeal_(?:dev|test|e2e|ci|wp17_ci|wp18_ci)$/i;

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
