import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { FIXED_STAGING_REF } from "./staging-migrate.mjs";
import { FIXED_PRODUCTION_REF, PRODUCTION_BACKUP_ARTIFACT_PREFIX, PRODUCTION_BACKUP_WORKFLOW } from "./production-migrate.mjs";
import {
  AGGREGATES_SQL, ARTIFACT_DIRECTORY, POSTGRES_IMAGE, POSTGRES_IMAGE_DIGEST, RECEIPT_NAME, RECEIPT_SCHEMA, RECIPIENT_FILE,
  SNAPSHOT_SCRIPT, classifyDumpFailure, parseRecipient, run, sourceSessionArgs, trigramOperatorSchema,
} from "./production-backup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Built from parts so the repository secret scan does not see a literal database URL.
const url = (authority) => ["postgresql:", "", `${authority}/postgres`].join("/");
const poolerHost = "aws-0-ap-south-1.pooler.supabase.com";
const password = "synthetic-backup-password";
const production = url(`postgres.${FIXED_PRODUCTION_REF}:${password}@${poolerHost}:6543`);
const staging = url(`postgres.${FIXED_STAGING_REF}:${password}@${poolerHost}:5432`);
const RECIPIENT = "age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq";
const TMPFS = { type: 0x01021994, bavail: 4 * 1024 * 1024, bsize: 4096 };
const AGE_HEADER = "age-encryption.org/v1\n";
const TOC = [
  ";", "; Archive created at 2026-11-03 00:00:00 UTC", ";",
  "1; 2615 2200 SCHEMA - public pg_database_owner",
  "2; 1259 16390 TABLE public _prisma_migrations postgres",
  "3; 0 16390 TABLE DATA public _prisma_migrations postgres",
  "4; 0 16400 TABLE DATA public PaymentTransaction postgres",
].join("\n");
const DDL = 'CREATE INDEX "FormSubmission_email_trgm_idx" ON public."FormSubmission" USING gin (email public.gin_trgm_ops);';

/** Mount source of a `--volume <host>:<container>[:ro]` argument. */
function mounted(args, containerPath) {
  const value = args[args.indexOf("--volume") + 1];
  return value.slice(0, value.lastIndexOf(`:${containerPath}`));
}

/**
 * Stands in for docker/age: the source session writes what the real psql
 * script writes (dump + markers + summaries); pg_restore answers from fixtures.
 */
function fakeExec({ session = "ok", digest = POSTGRES_IMAGE_DIGEST, ageHeader = AGE_HEADER } = {}) {
  const calls = [];
  const exec = (command, args, options = {}) => {
    calls.push({ command, args, env: options.env, input: options.input });
    if (command === "age" && args[0] === "--version") return { status: 0, stdout: "v1.1.1\n", stderr: "" };
    if (command === "age") {
      fs.writeFileSync(args[args.indexOf("--output") + 1], `${ageHeader}ciphertext-of-${path.basename(args.at(-1))}`);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "image") return { status: 0, stdout: `["postgres@${digest}"]\n`, stderr: "" };
    if (args.includes("--version")) return { status: 0, stdout: "pg_dump (PostgreSQL) 17.10\n", stderr: "" };
    if (args.includes("psql")) {
      const out = mounted(args, "/out");
      if (session === "auth") return { status: 2, stdout: "", stderr: `psql: error: connection to server at "${poolerHost}" failed: FATAL: password authentication failed for user "postgres.${FIXED_PRODUCTION_REF}"` };
      fs.writeFileSync(path.join(out, "production-public.dump"), "PGDMP synthetic archive");
      fs.writeFileSync(path.join(out, "pg_dump.ok"), "");
      fs.writeFileSync(path.join(out, "migrations.txt"), "133|20261031180000_live_session_switch_redemption\n");
      fs.writeFileSync(path.join(out, "migrations.ok"), "");
      fs.writeFileSync(path.join(out, "aggregates.txt"), "PaymentTransaction:PAID|3|3000|2850|0\nmigrations|133|||\n");
      if (session !== "drift") fs.writeFileSync(path.join(out, "aggregates.ok"), "");
      return { status: session === "drift" ? 3 : 0, stdout: "", stderr: "" };
    }
    if (args.includes("--list")) return { status: 0, stdout: TOC, stderr: "" };
    if (args.includes("--schema-only")) return { status: 0, stdout: DDL, stderr: "" };
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  };
  return { calls, exec };
}

function harness(execOptions, { url: databaseUrl = production, recipient = `# reviewed\n${RECIPIENT}\n`, statfs = TMPFS, env = {} } = {}) {
  const runnerTemp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-backup-runner-"));
  const shmRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cd-backup-shm-"));
  const fake = fakeExec(execOptions);
  const emitted = [];
  const result = run(
    { PRODUCTION_DATABASE_URL: databaseUrl, GITHUB_RUN_ID: "18765432101", GITHUB_RUN_ATTEMPT: "1", GITHUB_SHA: "a".repeat(40), RUNNER_TEMP: runnerTemp, PATH: "/usr/bin", HOME: "/home/runner", ...env },
    {
      exec: fake.exec, statfs: () => statfs, shmRoot, readRecipientSource: () => recipient,
      now: () => new Date("2026-11-03T01:00:00.000Z"), emit: (line) => emitted.push(line),
    },
  );
  const outDirectory = path.join(runnerTemp, ARTIFACT_DIRECTORY);
  return { result, calls: fake.calls, emitted, outDirectory, shmRoot };
}

test("the committed recipient is a single age public key and private identities are rejected", () => {
  const committed = fs.readFileSync(path.join(root, RECIPIENT_FILE), "utf8");
  assert.match(parseRecipient(committed) ?? "", /^age1[a-z0-9]{58}$/u);
  assert.equal(parseRecipient(fs.readFileSync(path.join(root, `${RECIPIENT_FILE}.example`), "utf8")), null);
  assert.equal(parseRecipient(`${RECIPIENT}\n${RECIPIENT}\n`), null);
  // An age private identity line (built from parts for the secret scan) is never a recipient.
  assert.equal(parseRecipient(["AGE", "SECRET", "KEY", `1${"Q".repeat(58)}`].join("-")), null);
  assert.equal(parseRecipient(""), null);
});

test("pg_trgm location comes from the archive DDL (F-074)", () => {
  assert.equal(trigramOperatorSchema(DDL), "public");
  assert.equal(trigramOperatorSchema(DDL.replace("public.gin_trgm_ops", "extensions.gin_trgm_ops")), "extensions");
  assert.equal(trigramOperatorSchema(`${DDL}\n${DDL.replace("public.gin_trgm_ops", "extensions.gist_trgm_ops")}`), "ambiguous");
  assert.equal(trigramOperatorSchema("CREATE TABLE public.x (id text);"), "none");
  assert.equal(trigramOperatorSchema(DDL.replace("public.gin_trgm_ops", "other.gin_trgm_ops")), "other");
});

test("client failures map to fixed categories", () => {
  assert.equal(classifyDumpFailure("FATAL: password authentication failed for user x"), "AUTHENTICATION");
  assert.equal(classifyDumpFailure("could not translate host name \"x\""), "DNS");
  assert.equal(classifyDumpFailure("pg_dump: error: aborting because of server version mismatch"), "VERSION_MISMATCH");
  assert.equal(classifyDumpFailure("ERROR: canceling statement due to lock timeout"), "LOCK_TIMEOUT");
  assert.equal(classifyDumpFailure("ERROR: invalid snapshot identifier"), "SNAPSHOT");
  assert.equal(classifyDumpFailure("something else"), "OTHER");
});

test("aggregates match the restore runbook §C and only reference existing columns", () => {
  const runbook = fs.readFileSync(path.join(root, "docs", "production-backup-restore-runbook.md"), "utf8").replace(/\r\n/gu, "\n");
  const block = /## C\.[\s\S]*?```sql\n([\s\S]*?)\n```/u.exec(runbook);
  assert.ok(block, "runbook §C SQL block");
  assert.equal(AGGREGATES_SQL, block[1]);

  const schema = fs.readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8").replace(/\r\n/gu, "\n");
  const models = new Map([...schema.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gmu)].map((match) => [match[1], match[2]]));
  for (const statement of AGGREGATES_SQL.split("UNION ALL").slice(1)) {
    const table = /FROM public\."(\w+)"/u.exec(statement)?.[1];
    assert.ok(models.has(table), `model ${table}`);
    // Database column names: the @map name when present, otherwise the field name.
    const columns = new Set([...models.get(table).matchAll(/^\s+(\w+)\s+\S[^\n]*$/gmu)]
      .map((match) => /@map\("(\w+)"\)/u.exec(match[0])?.[1] ?? match[1]));
    for (const column of [...statement.matchAll(/"(\w+)"/gu)].map((match) => match[1]).filter((name) => name !== table)) {
      assert.ok(columns.has(column), `${table}.${column}`);
    }
    assert.ok(columns.has("status"), `${table}.status`);
  }
});

test("one snapshot covers pg_dump, the migration summary and the aggregates, in the staging dump format", () => {
  const order = ["READ ONLY", "pg_export_snapshot()", "\\setenv CD_BACKUP_SNAPSHOT :cd_backup_snapshot", "pg_dump ", "migrations.txt", "aggregates.txt", "COMMIT;"];
  const positions = order.map((needle) => SNAPSHOT_SCRIPT.indexOf(needle));
  assert.ok(positions.every((value) => value >= 0), "every step present");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  const dump = SNAPSHOT_SCRIPT.split("\n").find((line) => line.startsWith("\\! pg_dump "));
  for (const flag of ["--format=custom", "--no-owner", "--no-privileges", "--schema=public", "--snapshot=\"$CD_BACKUP_SNAPSHOT\""]) assert.ok(dump.includes(flag), flag);
  assert.match(dump, /&& touch \/out\/pg_dump\.ok$/u);
  assert.doesNotMatch(SNAPSHOT_SCRIPT, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/u);
});

test("the source session gets PG* variables by name only, never the URL or password", () => {
  const args = sourceSessionArgs("/dev/shm/celebratedeal-production-backup-x");
  assert.ok(args.includes(POSTGRES_IMAGE));
  assert.deepEqual(args.filter((value, index) => args[index - 1] === "--env"), ["PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSSLMODE", "PGCONNECT_TIMEOUT", "PGAPPNAME"]);
  assert.ok(args.every((value) => !value.includes("=") || value === "ON_ERROR_STOP=1"));
});

test("a backup produces only ciphertext, checksums and a data-free receipt", () => {
  const { result, calls, emitted, outDirectory, shmRoot } = harness();
  assert.equal(result.code, 0, result.lines.join(","));
  assert.equal(result.lines.at(-1), "PRODUCTION_BACKUP_PASS");
  assert.ok(emitted.every((line) => line.startsWith("::add-mask::")));
  assert.ok(emitted.some((line) => line.includes(password)) && emitted.some((line) => line.includes(poolerHost)));

  assert.deepEqual(fs.readdirSync(outDirectory).sort(), [
    RECEIPT_NAME, "SHA256SUMS", "production-aggregates-18765432101.txt.age", "production-public-18765432101.dump.age",
  ].sort());
  assert.deepEqual(fs.readdirSync(shmRoot), [], "plaintext directory removed");
  const receipt = JSON.parse(fs.readFileSync(path.join(outDirectory, RECEIPT_NAME), "utf8"));
  assert.equal(receipt.schemaVersion, RECEIPT_SCHEMA);
  assert.equal(receipt.runId, "18765432101");
  assert.equal(receipt.dump.imageDigest, POSTGRES_IMAGE_DIGEST);
  assert.equal(receipt.dump.trigramOperatorSchema, "public");
  assert.equal(receipt.dump.tocEntries, 4);
  assert.deepEqual(receipt.migrations, { applied: 133, latest: "20261031180000_live_session_switch_redemption" });
  assert.equal(receipt.aggregates, "ENCRYPTED_SAME_SNAPSHOT");
  assert.equal(receipt.files.length, 2);

  const published = fs.readdirSync(outDirectory).map((name) => fs.readFileSync(path.join(outDirectory, name), "utf8")).join("\n") + result.lines.join("\n");
  for (const secret of [password, poolerHost, FIXED_PRODUCTION_REF, "PaymentTransaction:PAID", "PGDMP synthetic archive"]) {
    assert.ok(!published.includes(secret), `artifact or log leaks ${secret}`);
  }

  const session = calls.find((call) => call.args.includes("psql"));
  assert.equal(session.input, SNAPSHOT_SCRIPT);
  assert.equal(session.env.PGPASSWORD, password);
  assert.equal(session.env.PGHOST, poolerHost);
  assert.equal(session.env.PGPORT, "5432", "session pooler, never the transaction pooler");
  assert.equal(session.env.PGSSLMODE, "require");
  assert.ok(!Object.keys(session.env).some((key) => /DATABASE_URL|GITHUB_TOKEN/u.test(key)));
  for (const call of calls) assert.ok(call.args.every((value) => !value.includes(password) && !value.includes(poolerHost)));
  for (const call of calls.filter((entry) => entry.args.includes("pg_restore"))) assert.ok(call.args.includes("none") && call.args.some((value) => value.endsWith(":/in:ro")));
  assert.deepEqual(calls.filter((call) => call.command === "age" && call.args[0] === "--encrypt").map((call) => call.args[2]), [RECIPIENT, RECIPIENT]);
});

test("aggregates that fail on the pre-migration schema never block the backup", () => {
  const { result, outDirectory } = harness({ session: "drift" });
  assert.equal(result.code, 0);
  assert.ok(result.lines.includes("PRODUCTION_BACKUP_AGGREGATES UNAVAILABLE"));
  assert.deepEqual(fs.readdirSync(outDirectory).sort(), [RECEIPT_NAME, "SHA256SUMS", "production-public-18765432101.dump.age"].sort());
});

test("failures stop before or without leaving plaintext or a partial artifact", () => {
  const isStaging = harness(undefined, { url: staging });
  assert.deepEqual(isStaging.result, { code: 1, lines: ["PRODUCTION_DATABASE_IS_STAGING"] });
  assert.equal(isStaging.calls.length, 0);

  assert.deepEqual(harness(undefined, { env: { GITHUB_RUN_ID: "" } }).result.lines, ["PRODUCTION_BACKUP_RUN_CONTEXT_INVALID"]);
  assert.deepEqual(harness(undefined, { recipient: "age1replace_with_your_offline_backup_recipient_public_key\n" }).result.lines, ["PRODUCTION_BACKUP_RECIPIENT_INVALID"]);
  assert.deepEqual(harness({ digest: `sha256:${"0".repeat(64)}` }).result.lines, ["PRODUCTION_BACKUP_IMAGE_UNVERIFIED"]);
  assert.deepEqual(harness(undefined, { statfs: { ...TMPFS, type: 0xef53 } }).result.lines, ["PRODUCTION_BACKUP_TMPFS_UNAVAILABLE"]);

  const auth = harness({ session: "auth" });
  assert.deepEqual(auth.result, { code: 1, lines: ["PRODUCTION_BACKUP_DUMP_FAILED AUTHENTICATION"] });
  assert.equal(fs.existsSync(auth.outDirectory), false);
  assert.deepEqual(fs.readdirSync(auth.shmRoot), []);

  const notEncrypted = harness({ ageHeader: "PGDMP" });
  assert.deepEqual(notEncrypted.result, { code: 1, lines: ["PRODUCTION_BACKUP_ENCRYPTION_FAILED"] });
  assert.equal(fs.existsSync(notEncrypted.outDirectory), false);
  assert.deepEqual(fs.readdirSync(notEncrypted.shmRoot), []);
});

test("workflow is the pinned backup path: manual, protected master, production environment, ciphertext artifact only", () => {
  const source = fs.readFileSync(path.join(root, PRODUCTION_BACKUP_WORKFLOW), "utf8");
  const workflow = yaml.load(source);
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch, null, "no inputs: the target cannot be redirected");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(Object.keys(workflow.jobs), ["backup"]);
  const job = workflow.jobs.backup;
  assert.equal(job.environment, "production");
  assert.match(job.if, /github\.ref == 'refs\/heads\/master'/u);
  assert.match(job.if, /github\.ref_protected/u);

  const steps = job.steps;
  for (const step of steps) {
    if (typeof step.run === "string") assert.doesNotMatch(step.run, /\$\{\{/u, `${step.name} must pass values through env`);
    assert.equal(step["continue-on-error"], undefined, step.name);
    assert.equal(step.if, undefined, `${step.name} runs only while every earlier step succeeded`);
  }
  const secretRefs = [...source.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(secretRefs)], ["PRODUCTION_DATABASE_URL"]);
  const backupIndex = steps.findIndex((step) => step.run === "node scripts/production-backup.mjs");
  assert.ok(backupIndex > 0);
  assert.deepEqual(steps[backupIndex].env, { PRODUCTION_DATABASE_URL: "${{ secrets.PRODUCTION_DATABASE_URL }}" });
  assert.ok(steps.every((step, index) => index === backupIndex || !JSON.stringify(step).includes("secrets.")));
  const preload = steps.findIndex((step) => step.env?.PG_DIGEST);
  assert.ok(preload >= 0 && preload < backupIndex, "image and age are fetched before credentials");
  assert.equal(steps[preload].env.PG_DIGEST, POSTGRES_IMAGE_DIGEST);
  assert.ok(steps[preload].run.includes(`docker tag "$pulled" ${POSTGRES_IMAGE}`));
  const contract = steps.findIndex((step) => /node --test .*scripts\/production-backup\.test\.mjs/u.test(step.run ?? ""));
  assert.ok(contract >= 0 && contract < backupIndex);

  const upload = steps.at(-1);
  assert.equal(steps.indexOf(upload), backupIndex + 1);
  assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/u);
  assert.equal(upload.with.name, `${PRODUCTION_BACKUP_ARTIFACT_PREFIX}\${{ github.run_id }}`);
  assert.equal(upload.with.path, `\${{ runner.temp }}/${ARTIFACT_DIRECTORY}/`);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.ok(Number.isInteger(upload.with["retention-days"]) && upload.with["retention-days"] >= 1 && upload.with["retention-days"] <= 90);

  const actionUses = [...source.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.ok(actionUses.length >= 3 && actionUses.every((value) => /@[a-f0-9]{40}$/u.test(value)));
  assert.doesNotMatch(source, /pull_request|schedule:|workflow_call|secrets:\s*inherit|toJSON\(secrets\)|pg_dumpall/iu);
});
