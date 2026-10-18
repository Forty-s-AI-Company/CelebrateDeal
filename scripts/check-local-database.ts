import { assertLocalSchemaCurrent } from "./local-database-schema";
import { resolveLocalDatabaseUrl } from "./local-database-safety";

// Use injected configuration only: no dotenv loading, DB writes or auto-migrate.
// The test default matches vitest.config.ts; dev requires an explicit target.
async function check() {
  const databaseUrl = resolveLocalDatabaseUrl(process.env.DATABASE_URL,
    process.argv.includes("--test") ? "test" : "dev");
  return assertLocalSchemaCurrent(databaseUrl);
}

check()
  .then((result) => console.log(`[local_database_schema] current; migrations=${result.expected}`))
  .catch((error: unknown) => {
    console.error(error instanceof Error && error.message.startsWith("[local_database_")
      ? error.message : "[local_database_schema] check failed");
    process.exitCode = 1;
  });
