import { resolveDevMigrateTarget } from "./db-migrate-guard";
import { runPrismaMigrate } from "./db-migrate-run";

// `prisma migrate dev` can prompt to reset the database: loopback disposable only (F-065).
runPrismaMigrate("dev", () => resolveDevMigrateTarget(process.env));
