import { spawnSync } from "node:child_process";
import path from "node:path";
import { MigrateTargetError, validateMigrateArguments, type MigrateTarget } from "./db-migrate-guard";

/** Runs the local Prisma CLI with the validated, pinned migration target. */
export function runPrismaMigrate(command: "dev" | "deploy", resolveTarget: () => MigrateTarget) {
  let target: MigrateTarget;
  let args: string[];
  try {
    args = validateMigrateArguments(command, process.argv.slice(2));
    target = resolveTarget();
  } catch (error) {
    console.error(error instanceof MigrateTargetError ? error.message : "[migrate_target_safety] rejected; category=unknown");
    console.error("[migrate_target_safety] Inject the target into the shell; .env files are not read. See docs/production-database-runbook.md.");
    process.exitCode = 1;
    return;
  }
  console.log(`[migrate_target_safety] prisma migrate ${command}; target=${target.remote ? "remote-workflow" : "loopback-disposable"}`);
  const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  const child = spawnSync(process.execPath, [prismaCli, "migrate", command, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...target.childEnvironment },
    windowsHide: true,
  });
  process.exitCode = child.status ?? 1;
}
