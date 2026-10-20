import { resolveDeployMigrateTarget } from "./db-migrate-guard";
import { runPrismaMigrate } from "./db-migrate-run";

// Loopback disposable, or ALLOW_REMOTE_MIGRATE_DEPLOY=1 with an approved MIGRATE_DEPLOY_WORKFLOW (F-065).
runPrismaMigrate("deploy", () => resolveDeployMigrateTarget(process.env));
