import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = yaml.load(fs.readFileSync(path.join(root, ".github", "workflows", "staging-backup-recovery.yml"), "utf8"));

test("recovery workflow is dispatch-only, protected-master and fixed Preview environment", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  const job = workflow.jobs["isolated-recovery"];
  assert.match(job.if, /refs\/heads\/master/u);
  assert.match(job.if, /github\.ref_protected/u);
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
});

test("private identity is injected only after fixed artifact and receipt validation", () => {
  const steps = workflow.jobs["isolated-recovery"].steps;
  const attest = steps.find((step) => step.name === "Attest fixed protected backup run and artifacts");
  const archive = steps.find((step) => step.name === "Download fixed encrypted backup artifact");
  const backupReceipt = steps.find((step) => step.name === "Download fixed sanitized backup receipt");
  const preflight = steps.find((step) => step.name === "Verify downloaded receipt and ciphertext before private key injection");
  const recovery = steps.find((step) => step.id === "recover");
  const upload = steps.find((step) => step.name === "Upload sanitized recovery receipt only");
  assert.ok(steps.indexOf(attest) < steps.indexOf(archive));
  assert.ok(steps.indexOf(archive) < steps.indexOf(backupReceipt));
  assert.ok(steps.indexOf(backupReceipt) < steps.indexOf(preflight));
  assert.ok(steps.indexOf(preflight) < steps.indexOf(recovery));
  assert.ok(steps.indexOf(recovery) < steps.indexOf(upload));
  assert.deepEqual(Object.keys(recovery.env).sort(), ["BACKUP_RUN_ID", "RUNNER_TEMP", "STAGING_BACKUP_AGE_IDENTITY"]);
  assert.equal(recovery.env.STAGING_BACKUP_AGE_IDENTITY, "${{ secrets.STAGING_BACKUP_AGE_IDENTITY }}");
  assert.equal(archive.with.name, "secure-staging-encrypted-backup-9193326824b8b6bf774bdfa28e4783a1a1b8f304");
  assert.equal(backupReceipt.with.name, "secure-staging-wp2-readonly-restore-9193326824b8b6bf774bdfa28e4783a1a1b8f304");
  assert.match(upload.with.path, /staging-backup-recovery-receipt\.json$/u);
  const uses = steps.filter((step) => step.uses).map((step) => step.uses);
  assert.equal(uses.every((value) => /@[a-f0-9]{40}$/u.test(value)), true);
  assert.doesNotMatch(JSON.stringify(workflow), /STAGING_DATABASE_URL|DATABASE_URL|prisma migrate deploy|workflow_call|pull_request_target/iu);
});

test("plaintext recovery has no staging connection and uses network-disabled tmpfs", () => {
  const source = fs.readFileSync(path.join(root, "scripts", "staging-backup-recovery.mjs"), "utf8");
  assert.match(source, /"--network", "none"/u);
  assert.match(source, /"--tmpfs", "\/var\/lib\/postgresql\/data:rw,size=2g", "--tmpfs", "\/tmp:rw,size=768m"/u);
  assert.match(source, /fs\.statfsSync\("\/dev\/shm"\)/u);
  assert.doesNotMatch(source, /STAGING_DATABASE_URL|DATABASE_URL|prisma migrate deploy/iu);
});
