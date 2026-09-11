import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { listCanonicalMigrations, writeMirror } from "./prisma-loopback-disposable-migration-runner.mjs";
import { buildIsolatedEnvironment } from "./private-chat-disposable-qa.mjs";

// 只建立原先不存在的 allowlisted loopback DB；保留 ownership marker 才可清除。
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "presenter-"));
const marker = `presenter:${randomUUID()}`;
const environment = { ...buildIsolatedEnvironment(temp), PGPASSWORD: "postgres", PGCONNECT_TIMEOUT: "5" };
for (const dir of ["tmp", "home", "profile"]) fs.mkdirSync(path.join(temp, dir), { recursive: true });
fs.writeFileSync(path.join(temp, ".marker"), marker);
const run = (command, args, env = environment, cwd = root) => spawnSync(command, args, { env, cwd, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const query = (db, sql) => run("C:/Users/eden/scoop/apps/postgresql/current/bin/psql.exe", ["-X", "-w", "-h", "127.0.0.1", "-p", "54329", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-A", "-t", "-q", "-c", sql]);
const receipt = { boundary: "real PostgreSQL canonical migrations, tenant FK, unique sessions, cleanup claim and source CAS; synthetic auth/provider", status: "FAIL", phases: {}, tests: [], cleanup: "NOT_CREATED" };
const evidencePath = path.join(root, "docs/live-feature-handoffs/presenter-db-evidence.json");
if (fs.existsSync(evidencePath)) receipt.previousAttempts = [JSON.parse(fs.readFileSync(evidencePath, "utf8"))];
let owned;
try {
  for (const name of ["celebratedeal_ci", "celebratedeal_wp17_ci", "celebratedeal_wp18_ci"]) {
    const exists = query("postgres", `SELECT count(*) FROM pg_database WHERE datname='${name}'`);
    if (exists.status !== 0) throw new Error("LOOPBACK_UNREACHABLE");
    if (exists.stdout.trim() !== "0") continue;
    if (query("postgres", `CREATE DATABASE "${name}" TEMPLATE template0`).status !== 0) throw new Error("CREATE_FAILED");
    owned = name;
    if (query("postgres", `COMMENT ON DATABASE "${name}" IS '${marker}'`).status !== 0) throw new Error("MARKER_FAILED");
    break;
  }
  if (!owned) throw new Error("NO_UNUSED_DATABASE");
  const migrations = listCanonicalMigrations();
  for (const migration of migrations) if (/\b(?:CREATE|ALTER|DROP)\s+(?:ROLE|USER|DATABASE|SYSTEM)\b/iu.test(fs.readFileSync(path.join(root, "prisma/migrations", migration, "migration.sql"), "utf8"))) throw new Error("CLUSTER_MUTATION_REJECTED");
  const mirror = writeMirror(temp, migrations);
  const env = buildIsolatedEnvironment(temp, { databaseUrl: `postgresql://postgres:postgres@127.0.0.1:54329/${owned}?schema=public`, enableDatabaseTest: true });
  for (const [name, args] of [["validate", ["validate"]], ["migrate", ["migrate", "deploy"]]]) {
    const result = run(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), ...args, "--config", path.join(mirror, "prisma.config.mjs")], env, mirror);
    receipt.phases[name] = result.status === 0 ? "PASS" : "FAIL";
    if (result.status !== 0) throw new Error("MIGRATION_FAILED");
  }
  const report = path.join(temp, "tests.json");
  const result = run(process.execPath, [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "src/lib/presenter-layout.db.test.ts", "--reporter=json", "--outputFile", report], env);
  const data = JSON.parse(fs.readFileSync(report, "utf8"));
  receipt.tests = data.testResults.flatMap(s => s.assertionResults.map(t => ({ title: t.title, status: t.status, failures: t.failureMessages.map(m => m.replace(/postgresql:\/\/\S+/g, "[redacted]")) })));
  if (result.status !== 0 || receipt.tests.length !== 6 || receipt.tests.some(t => t.status !== "passed")) throw new Error("TEST_FAILED");
  receipt.status = "PASS";
} catch (error) { receipt.failure = /^[A-Z_]+$/.test(error.message) ? error.message : "RUNNER_FAILED"; }
finally {
  if (owned) {
    const check = query("postgres", `SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='${owned}'`);
    receipt.cleanup = check.status === 0 && check.stdout.trim() === marker && query("postgres", `DROP DATABASE "${owned}"`).status === 0 ? "PASS" : "BLOCKED";
  }
  if (path.dirname(temp) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith("presenter-") && fs.readFileSync(path.join(temp, ".marker"), "utf8") === marker) fs.rmSync(temp, { recursive: true });
  if (receipt.cleanup !== "PASS") receipt.status = "FAIL";
  fs.writeFileSync(path.join(root, "docs/live-feature-handoffs/presenter-db-evidence.json"), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify(receipt));
process.exitCode = receipt.status === "PASS" ? 0 : 1;
