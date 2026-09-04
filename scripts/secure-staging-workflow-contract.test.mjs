import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github", "workflows", "secure-staging-validation.yml");

test("master cannot trigger an automatic Vercel deployment", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(config.git?.deploymentEnabled?.master, false);
});

test("secure staging workflow is valid YAML and protected-default-branch only", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  const job = workflow.jobs["trusted-runner"];
  assert.match(String(job.if), /refs\/heads\/master/u);
  assert.match(String(job.if), /github\.ref_protected/u);
  assert.equal(job.environment, "Preview – celebrate-deal-staging");
  assert.deepEqual(workflow.permissions, { contents: "read", deployments: "read" });
});

test("workflow exposes only the fixed WP2 and WP4 tasks with pinned actions", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.task.options, [
    "wp2-readonly-restore",
    "wp4-payuni-sandbox-binding-preflight",
    "wp4-payuni-sandbox-reconciliation",
    "wp4-payuni-sandbox-refund-recovery",
    "wp4-payuni-buyer-payment-check",
    "wp4-payuni-buyer-callback-retry",
    "wp4-payuni-buyer-existing-continuation",
    "wp4-payuni-sandbox-subscription",
  ]);
  assert.match(source, /npm run secure:staging:wp2/u);
  assert.match(source, /npm run secure:staging:wp4/u);
  assert.match(source, /id: execute-wp2\s*\n\s*continue-on-error: true/u);
  assert.match(source, /id: execute-wp4\s*\n\s*continue-on-error: true/u);
  assert.match(source, /steps\.execute-wp2\.outcome != 'success'/u);
  assert.match(source, /steps\.execute-wp4\.outcome != 'success'/u);
  assert.ok(source.indexOf("Validate sanitized WP2 receipt") < source.indexOf("Enforce fixed WP2 task success"));
  assert.ok(source.indexOf("Validate sanitized WP4 receipt") < source.indexOf("Enforce fixed WP4 task success"));
  assert.ok(source.indexOf("Validate sanitized existing-refund recovery receipt") < source.indexOf("Enforce fixed existing-refund recovery success"));
  assert.ok(source.indexOf("Upload sanitized receipt only") < source.indexOf("Enforce fixed WP2 task success"));
  assert.doesNotMatch(source, /vercel\s+env\s+(?:pull|run)|toJSON\(secrets\)|secrets:\s*inherit|workflow_call|pull_request_target/iu);
  assert.doesNotMatch(source, /PAYUNI_(?:API|BASE|PRODUCTION)_URL|(?<!sandbox-)api\.payuni\.com\.tw/iu);
  const actionUses = [...source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.equal(actionUses.length, 8);
  assert.equal(actionUses.every((value) => /@[a-f0-9]{40}$/u.test(value)), true);
});

test("secret-aware step preloads tools and installs fixed-host egress", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const runner = fs.readFileSync(path.join(root, "scripts", "secure-staging-runner.mjs"), "utf8");
  const wp4Runner = fs.readFileSync(path.join(root, "scripts", "secure-staging-wp4-payuni.mjs"), "utf8");
  assert.match(source, /docker pull postgres:17-alpine/u);
  assert.match(source, /npx playwright install --with-deps chromium/u);
  assert.equal((source.match(/iptables -P OUTPUT DROP/gu) ?? []).length, 6);
  assert.equal((source.match(/ip6tables -P OUTPUT DROP/gu) ?? []).length, 4);
  assert.match(source, /api\.github\.com/u);
  assert.equal((source.match(/sandbox-api\.payuni\.com\.tw/gu) ?? []).length, 1);
  assert.match(source, /getent ahostsv4/u);
  assert.equal((source.match(/awk '!seen\[\$1\]\+\+ \{ print \$1 \}'/gu) ?? []).length, 5);
  assert.match(source, /iptables-restore/u);
  assert.match(runner, /"--network", "host"/u);
  assert.match(runner, /\/etc\/hosts:\/etc\/hosts:ro/u);
  assert.match(runner, /"--network", "none"/u);
  assert.match(wp4Runner, /function childEnvironment/u);
  assert.match(wp4Runner, /spawnSyncImpl\(process\.execPath/u);
  assert.doesNotMatch(wp4Runner, /Object\.(?:keys|entries)\(process\.env\)/u);
  assert.doesNotMatch(source, /curl\s+\$|wget\s+\$|Invoke-Expression|\beval\b/iu);
});

test("required PostgreSQL concurrency gate fails closed instead of hanging indefinitely", () => {
  const source = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(
    source,
    /timeout --preserve-status 10m npm run test:db:concurrency/u,
  );
  assert.doesNotMatch(source, /test:db:concurrency[^\n]*(?:--exclude|--skip|--passWithNoTests)/u);
});

test("WP4 is protected-master only, Sandbox fixed-host only, and cannot execute arbitrary commands", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  const steps = workflow.jobs["trusted-runner"].steps;
  const dispatchPreflight = steps.find((step) => step.name === "Validate fixed WP4 dispatch identity before secret injection");
  const bindingPreflight = steps.find((step) => step.name === "Validate fixed WP4 Sandbox bindings without execution");
  const wp4 = steps.find((step) => step.id === "execute-wp4");
  assert.match(String(dispatchPreflight.if), /inputs\.task == 'wp4-payuni-sandbox-reconciliation'/u);
  assert.match(String(dispatchPreflight.if), /inputs\.task == 'wp4-payuni-sandbox-binding-preflight'/u);
  assert.deepEqual(Object.keys(dispatchPreflight.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "GITHUB_TOKEN"]);
  assert.equal(dispatchPreflight.env.CELEBRATEDEAL_SOURCE_SHA, "${{ inputs.source_sha }}");
  assert.equal(dispatchPreflight.env.CELEBRATEDEAL_DEPLOYMENT_HOST, "${{ inputs.deployment_host }}");
  assert.equal(dispatchPreflight.env.GITHUB_TOKEN, "${{ github.token }}");
  assert.match(dispatchPreflight.run, /node scripts\/mvp-payuni-sandbox-e2e\.mjs --verify-lineage/u);
  assert.doesNotMatch(dispatchPreflight.run, /secrets\.|\$\{\{\s*inputs\./u);
  assert.ok(source.indexOf(dispatchPreflight.name) < source.indexOf("Execute fixed WP4 PayUni Sandbox task with bounded egress"));
  assert.match(String(bindingPreflight.if), /inputs\.task == 'wp4-payuni-sandbox-binding-preflight'/u);
  assert.deepEqual(Object.keys(bindingPreflight.env).sort(), [
    "JOB_SECRET",
    "PAYUNI_SANDBOX_ONETIME_CARD_NO",
    "PAYUNI_TEST_CVV",
    "PAYUNI_TEST_EXPIRY",
  ]);
  assert.match(bindingPreflight.run, /secure_wp4_missing_bindings/u);
  assert.match(bindingPreflight.run, /::error title=WP4 Sandbox binding preflight/u);
  assert.doesNotMatch(bindingPreflight.run, /process\.env\s*[).]|Object\.(?:keys|entries)\(process\.env\)/u);
  assert.ok(source.indexOf(dispatchPreflight.name) < source.indexOf(bindingPreflight.name));
  assert.equal(String(wp4.if), "${{ inputs.task == 'wp4-payuni-sandbox-reconciliation' || inputs.task == 'wp4-payuni-sandbox-subscription' }}");
  assert.deepEqual(Object.keys(wp4.env).sort(), [
    "CELEBRATEDEAL_DEPLOYMENT_HOST",
    "CELEBRATEDEAL_SOURCE_SHA",
    "GITHUB_TOKEN",
    "JOB_SECRET",
    "PAYUNI_ENV",
    "PAYUNI_SANDBOX_ONETIME_CARD_NO",
    "PAYUNI_TEST_CVV",
    "PAYUNI_TEST_EXPIRY",
    "WP4_TASK",
  ]);
  assert.equal(wp4.env.JOB_SECRET, "${{ secrets.JOB_SECRET }}");
  for (const binding of ["PAYUNI_SANDBOX_ONETIME_CARD_NO", "PAYUNI_TEST_EXPIRY", "PAYUNI_TEST_CVV"]) {
    assert.equal(wp4.env[binding], "${{ secrets." + binding + " }}");
  }
  assert.equal(wp4.env.PAYUNI_ENV, "sandbox");
  assert.equal(wp4.env.PAYUNI_SANDBOX_ONETIME_CARD_NO, "${{ secrets.PAYUNI_SANDBOX_ONETIME_CARD_NO }}");
  assert.equal(wp4.run.includes("sandbox-api.payuni.com.tw"), true);
  assert.equal(wp4.run.includes("sandbox-vendor.payuni.com.tw"), true);
  assert.doesNotMatch(JSON.stringify(wp4.env), /STAGING_DATABASE_URL|PAYUNI_(?:MERCHANT|HASH)/u);
  assert.equal(wp4.run.includes("npm run secure:staging:wp4"), true);
  assert.doesNotMatch(wp4.run, /\$\{\{\s*inputs\.(?:command|script|args)/u);
});

test("existing-refund recovery verifies the current Preview before JOB binding and runs only one query-only command", () => {
  const source = fs.readFileSync(workflowPath, "utf8");
  const workflow = yaml.load(source);
  const steps = workflow.jobs["trusted-runner"].steps;
  const chromium = steps.find((step) => step.name === "Preload Chromium before WP4 secret injection");
  const lineage = steps.find((step) => step.name === "Validate fixed existing-refund recovery identity before JOB binding");
  const recovery = steps.find((step) => step.id === "execute-wp4-existing-refund-recovery");
  const validate = steps.find((step) => step.name === "Validate sanitized existing-refund recovery receipt");
  const upload = steps.find((step) => step.name === "Upload sanitized existing-refund recovery receipt only");
  const enforce = steps.find((step) => step.name === "Enforce fixed existing-refund recovery success");

  assert.equal(chromium.if, "${{ inputs.task == 'wp4-payuni-sandbox-reconciliation' || inputs.task == 'wp4-payuni-sandbox-subscription' }}");
  assert.equal(lineage.if, "${{ inputs.task == 'wp4-payuni-sandbox-refund-recovery' }}");
  assert.deepEqual(Object.keys(lineage.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "GITHUB_TOKEN"]);
  assert.doesNotMatch(lineage.run, /CELEBRATEDEAL_SOURCE_SHA" !=/u);
  assert.match(lineage.run, /set -euo pipefail/u);
  // Recovery selection stays fixed in code; dispatch only selects a verified
  // execution deployment, never a transaction or historical source override.
  const runner = fs.readFileSync(new URL("./mvp-payuni-sandbox-e2e.mjs", import.meta.url), "utf8");
  assert.match(runner, /transactionSourceSha: EXISTING_REFUND_RECOVERY_SOURCE_SHA/u);
  assert.match(runner, /EXISTING_REFUND_RECOVERY_SOURCE_SHA = "1052a46d002149b5c06104927ed0fab32b049214"/u);
  assert.match(lineage.run, /node scripts\/mvp-payuni-sandbox-e2e\.mjs --verify-lineage/u);
  assert.doesNotMatch(lineage.run, /secrets\.|\$\{\{\s*inputs\./u);
  assert.ok(steps.indexOf(lineage) < steps.indexOf(recovery));

  assert.equal(recovery.if, "${{ inputs.task == 'wp4-payuni-sandbox-refund-recovery' }}");
  assert.deepEqual(Object.keys(recovery.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "JOB_SECRET"]);
  assert.equal(recovery.env.JOB_SECRET, "${{ secrets.JOB_SECRET }}");
  assert.match(recovery.run, /\["api\.github\.com", "443"\]/u);
  assert.match(recovery.run, /\[deploymentHost, "443"\]/u);
  assert.match(recovery.run, /node scripts\/mvp-payuni-sandbox-e2e\.mjs --recover-existing-refund/u);
  assert.match(recovery.run, /!\/\^\[a-f0-9\]\{40\}\$\/u\.test\(process\.env\.CELEBRATEDEAL_SOURCE_SHA\)/u);
  assert.doesNotMatch(recovery.run, /CELEBRATEDEAL_SOURCE_SHA\s*!==\s*"1052a46d002149b5c06104927ed0fab32b049214"/u);
  assert.match(recovery.run, /process\.stdout\.write\(\[\s*\["api\.github\.com", "443"\],\s*\[deploymentHost, "443"\]/u);
  assert.match(recovery.run, /sudo iptables -P OUTPUT DROP/u);
  assert.match(recovery.run, /sudo ip6tables -P OUTPUT DROP/u);
  assert.match(recovery.run, /sudo iptables-restore/u);
  assert.match(recovery.run, /sudo ip6tables-restore/u);
  assert.doesNotMatch(JSON.stringify(recovery.env), /GITHUB_TOKEN|PAYUNI|CARD|STAGING_DATABASE_URL|MERCHANT|HASH/u);
  assert.doesNotMatch(recovery.run, /playwright|chromium|sandbox-api\.payuni|sandbox-vendor\.payuni|wp4-(?:fixture|payment-attempt|refund)/iu);
  assert.doesNotMatch(recovery.run, /\$\{\{\s*inputs\.(?:command|script|args)/u);

  assert.equal(validate.run, "node scripts/mvp-payuni-sandbox-e2e.mjs --validate-recovery-receipt");
  assert.equal(upload.with.path, "${{ runner.temp }}/celebratedeal-secure-receipts/wp4-payuni-sandbox-refund-recovery-receipt.json");
  assert.match(String(enforce.if), /steps\.execute-wp4-existing-refund-recovery\.outcome != 'success'/u);
  assert.ok(steps.indexOf(validate) < steps.indexOf(upload));
  assert.ok(steps.indexOf(upload) < steps.indexOf(enforce));
});

test("fixed subscription task has its own command and receipt without broadening secret access", () => {
  const workflow = yaml.load(fs.readFileSync(workflowPath, "utf8"));
  const steps = workflow.jobs["trusted-runner"].steps;
  const execute = steps.find((step) => step.id === "execute-wp4");
  const lineage = steps.find((step) => step.name === "Validate fixed WP4 dispatch identity before secret injection");
  const validate = steps.find((step) => step.name === "Validate sanitized subscription receipt");
  const enforce = steps.find((step) => step.name === "Enforce fixed WP4 task success");
  for (const step of [lineage, execute, validate, enforce]) {
    assert.match(step.if, /inputs.task == 'wp4-payuni-sandbox-subscription'/u);
  }
  assert.match(execute.run, /if \[ "\$WP4_TASK" = "wp4-payuni-sandbox-subscription" \]; then\s+node scripts\/mvp-payuni-sandbox-e2e\.mjs --subscription/u);
  assert.equal(validate.run, "node scripts/mvp-payuni-sandbox-e2e.mjs --validate-subscription-receipt");
  assert.deepEqual(Object.keys(execute.env).sort(), [
    "CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "GITHUB_TOKEN", "JOB_SECRET", "PAYUNI_ENV",
    "PAYUNI_SANDBOX_ONETIME_CARD_NO", "PAYUNI_TEST_CVV", "PAYUNI_TEST_EXPIRY", "WP4_TASK",
  ]);
  assert.ok(steps.indexOf(lineage) < steps.indexOf(execute));
  assert.ok(steps.indexOf(execute) < steps.indexOf(validate));
  assert.ok(steps.indexOf(validate) < steps.indexOf(enforce));
});

test("buyer payment check has isolated query-only execution after exact lineage and before sanitized upload", () => {
  const steps = yaml.load(fs.readFileSync(workflowPath, "utf8")).jobs["trusted-runner"].steps;
  const lineage = steps.find((s) => s.name === "Validate fixed buyer-payment check identity before JOB binding");
  const execute = steps.find((s) => s.id === "execute-wp4-buyer-payment-check");
  const validate = steps.find((s) => s.name === "Validate sanitized buyer-payment check receipt");
  const upload = steps.find((s) => s.name === "Upload sanitized buyer-payment check receipt only");
  const enforce = steps.find((s) => s.name === "Enforce fixed buyer-payment check success");
  assert.equal(execute.if, "${{ inputs.task == 'wp4-payuni-buyer-payment-check' }}");
  assert.equal(lineage.if, execute.if);
  assert.match(lineage.run, /--verify-lineage/u);
  assert.deepEqual(Object.keys(execute.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "JOB_SECRET"]);
  assert.deepEqual(Object.keys(lineage.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "GITHUB_TOKEN"]);
  assert.match(execute.run, /node scripts\/mvp-payuni-sandbox-e2e\.mjs --check-buyer-payment/u);
  assert.match(execute.run, /sudo iptables -P OUTPUT DROP/u);
  assert.match(execute.run, /sudo ip6tables -P OUTPUT DROP/u);
  assert.doesNotMatch(execute.run, /playwright|chromium|sandbox-api\.payuni|sandbox-vendor\.payuni|--subscription|--recover-existing-refund/iu);
  assert.equal(validate.run, "node scripts/mvp-payuni-sandbox-e2e.mjs --validate-buyer-payment-check-receipt");
  assert.equal(upload.with.path, "${{ runner.temp }}/celebratedeal-secure-receipts/wp4-payuni-buyer-payment-check-receipt.json");
  assert.match(enforce.if, /steps\.execute-wp4-buyer-payment-check\.outcome != 'success'/u);
  assert.ok(steps.indexOf(lineage) < steps.indexOf(execute));
  assert.ok(steps.indexOf(execute) < steps.indexOf(validate));
  assert.ok(steps.indexOf(validate) < steps.indexOf(upload));
  assert.ok(steps.indexOf(upload) < steps.indexOf(enforce));
});

test("fixed callback retry has no card/provider binding and validates before upload", () => {
  const steps = yaml.load(fs.readFileSync(workflowPath, "utf8")).jobs["trusted-runner"].steps;
  const lineage = steps.find((s) => s.name === "Validate fixed buyer-callback retry identity before JOB binding");
  const execute = steps.find((s) => s.id === "execute-wp4-buyer-callback-retry");
  const validate = steps.find((s) => s.name === "Validate sanitized buyer-callback retry receipt");
  const upload = steps.find((s) => s.name === "Upload sanitized buyer-callback retry receipt only");
  const enforce = steps.find((s) => s.name === "Enforce fixed buyer-callback retry success");
  assert.equal(execute.if, "${{ inputs.task == 'wp4-payuni-buyer-callback-retry' }}");
  assert.equal(lineage.if, execute.if);
  assert.match(lineage.run, /--verify-lineage/u);
  assert.deepEqual(Object.keys(execute.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "JOB_SECRET"]);
  assert.deepEqual(Object.keys(lineage.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "GITHUB_TOKEN"]);
  assert.match(execute.run, /--retry-buyer-callback/u);
  assert.match(execute.run, /sudo iptables -P OUTPUT DROP/u);
  assert.match(execute.run, /sudo ip6tables -P OUTPUT DROP/u);
  assert.doesNotMatch(execute.run, /playwright|chromium|sandbox-api\.payuni|sandbox-vendor\.payuni|--subscription|--recover-existing-refund/iu);
  assert.equal(validate.run, "node scripts/mvp-payuni-sandbox-e2e.mjs --validate-buyer-callback-retry-receipt");
  assert.equal(upload.with.path, "${{ runner.temp }}/celebratedeal-secure-receipts/wp4-payuni-buyer-callback-retry-receipt.json");
  assert.match(enforce.if, /steps\.execute-wp4-buyer-callback-retry\.outcome != 'success'/u);
  assert.ok(steps.indexOf(lineage) < steps.indexOf(execute));
  assert.ok(steps.indexOf(execute) < steps.indexOf(validate));
  assert.ok(steps.indexOf(validate) < steps.indexOf(upload));
  assert.ok(steps.indexOf(upload) < steps.indexOf(enforce));
});

test("fixed buyer continuation has no card/provider binding and validates before upload", () => {
  const steps = yaml.load(fs.readFileSync(workflowPath, "utf8")).jobs["trusted-runner"].steps;
  const lineage = steps.find((s) => s.name === "Validate fixed buyer-existing continuation identity before JOB binding");
  const execute = steps.find((s) => s.id === "execute-wp4-buyer-existing-continuation");
  const validate = steps.find((s) => s.name === "Validate sanitized buyer-existing continuation receipt");
  const upload = steps.find((s) => s.name === "Upload sanitized buyer-existing continuation receipt only");
  const enforce = steps.find((s) => s.name === "Enforce fixed buyer-existing continuation success");
  assert.equal(execute.if, "${{ inputs.task == 'wp4-payuni-buyer-existing-continuation' }}");
  assert.equal(lineage.if, execute.if);
  assert.match(lineage.run, /--verify-lineage/u);
  assert.deepEqual(Object.keys(execute.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "JOB_SECRET"]);
  assert.deepEqual(Object.keys(lineage.env).sort(), ["CELEBRATEDEAL_DEPLOYMENT_HOST", "CELEBRATEDEAL_SOURCE_SHA", "GITHUB_TOKEN"]);
  assert.match(execute.run, /--continue-existing-buyer/u);
  assert.match(execute.run, /sudo iptables -P OUTPUT DROP/u);
  assert.match(execute.run, /sudo ip6tables -P OUTPUT DROP/u);
  assert.doesNotMatch(execute.run, /playwright|chromium|sandbox-api\.payuni|sandbox-vendor\.payuni|--subscription|--recover-existing-refund/iu);
  assert.equal(validate.run, "node scripts/mvp-payuni-sandbox-e2e.mjs --validate-buyer-continuation-receipt");
  assert.equal(upload.with.path, "${{ runner.temp }}/celebratedeal-secure-receipts/wp4-payuni-buyer-existing-continuation-receipt.json");
  assert.match(enforce.if, /steps\.execute-wp4-buyer-existing-continuation\.outcome != 'success'/u);
  assert.ok(steps.indexOf(lineage) < steps.indexOf(execute));
  assert.ok(steps.indexOf(execute) < steps.indexOf(validate));
  assert.ok(steps.indexOf(validate) < steps.indexOf(upload));
  assert.ok(steps.indexOf(upload) < steps.indexOf(enforce));
});

test("WP4 egress heredoc is syntactically valid without executing it", () => {
  const workflow = yaml.load(fs.readFileSync(workflowPath, "utf8"));
  const source = workflow.jobs["trusted-runner"].steps.find((step) => step.id === "execute-wp4").run;
  const match = source.match(/node <<'NODE' > "\$destinations"\r?\n([\s\S]*?)\r?\n\s*NODE/u);
  assert.ok(match?.[1]);
  assert.match(match[1], /sandbox-api\.payuni\.com\.tw/u);
  assert.doesNotThrow(() => new vm.Script(match[1]));
  // Reproduce the broken call delimiter to prove this checks the affected JS.
  const broken = match[1].replace("const destinations = [", "process.stdout.write([");
  assert.notEqual(broken, match[1]);
  assert.throws(() => new vm.Script(broken), SyntaxError);
});
