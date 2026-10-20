import { resolveDeployMigrateTarget } from "./db-migrate-guard";
import { runPrismaMigrate } from "./db-migrate-run";

// Loopback disposable, or ALLOW_REMOTE_MIGRATE_DEPLOY=1 inside a GitHub Actions/Vercel build (F-065).
runPrismaMigrate("deploy", () => resolveDeployMigrateTarget(process.env));
