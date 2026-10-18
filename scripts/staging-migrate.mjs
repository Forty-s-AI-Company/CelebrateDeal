// Applies (or reports) the current master migration chain on the fixed,
// non-Production staging Supabase project. Run only from the protected
// "Staging migrate" workflow; the database URL comes from that GitHub
// environment and is never printed.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const FIXED_STAGING_REF = "ocbugvgojrunvenozsbx";
const MODES = new Set(["status", "deploy"]);

/** Return a fixed failure code for an unsafe target, or null when it is the staging project. */
export function stagingDatabaseFailureCode(value) {
  let db;
  try { db = new URL(value ?? ""); } catch { return "STAGING_DATABASE_URL_INVALID"; }
  if (!["postgres:", "postgresql:"].includes(db.protocol)) return "STAGING_DATABASE_URL_INVALID";
  if (/(?:^|[.-])prod(?:uction)?(?:$|[.-])/iu.test(db.hostname)) return "STAGING_DATABASE_PRODUCTION_HOST";
  const user = decodeURIComponent(db.username);
  const direct = db.hostname === `db.${FIXED_STAGING_REF}.supabase.co` && user === "postgres";
  const pooler = db.hostname.endsWith(".pooler.supabase.com") && user === `postgres.${FIXED_STAGING_REF}`;
  if (!direct && !pooler) return "STAGING_PROJECT_MISMATCH";
  // Session mode only: Prisma migrations cannot run through the 6543 transaction pooler.
  if ((db.port || "5432") !== "5432") return "STAGING_DATABASE_PORT_INVALID";
  if (db.pathname !== "/postgres" || !db.password) return "STAGING_DATABASE_URL_INVALID";
  return null;
}

/** Keep only migration names and Prisma's summary lines; drop anything that could carry a credential or host. */
export function sanitizePrismaOutput(text) {
  return String(text).split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/postgres(?:ql)?:\/\/|supabase|password|@|datasource/iu.test(line) && !line.includes(FIXED_STAGING_REF))
    .filter((line) => /^\d{12,14}_[a-z0-9_]+\/?$|^└─|migrations? found|have not yet been applied|not found locally|up to date|successfully applied|No pending|following migration|failed|error/iu.test(line))
    .slice(0, 200);
}

export function run(mode, env = process.env) {
  if (!MODES.has(mode)) return { code: 2, lines: ["STAGING_MIGRATE_MODE_INVALID"] };
  const failure = stagingDatabaseFailureCode(env.STAGING_DATABASE_URL);
  if (failure) return { code: 1, lines: [failure] };
  const url = env.STAGING_DATABASE_URL;
  const child = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", mode], {
    encoding: "utf8",
    env: { PATH: env.PATH ?? "", HOME: env.HOME ?? "", DATABASE_URL: url, DIRECT_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
  return { code: child.status ?? 1, lines: sanitizePrismaOutput(`${child.stdout ?? ""}\n${child.stderr ?? ""}`) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = run(process.argv[2]);
  for (const line of result.lines) console.log(line);
  process.exitCode = result.code;
}
