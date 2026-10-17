import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const workflow = readFileSync(".github/workflows/q1-original-refund.yml", "utf8");
test("only protected master validates contracts and lineage before staging bindings", () => {
  assert.match(workflow, /github.ref == 'refs\/heads\/master' && github.ref_protected/);
  assert.match(workflow, /environment: Preview – celebrate-deal-staging/);
  assert.match(workflow, /persist-credentials: false/);
  assert.ok(workflow.indexOf("node --test") < workflow.indexOf("secrets.STAGING_DATABASE_URL"));
  assert.ok(workflow.indexOf("--verify-lineage") < workflow.indexOf("secrets.STAGING_DATABASE_URL"));
  assert.ok(workflow.indexOf("playwright install") < workflow.indexOf("secrets.PAYUNI_QA_FINANCE_PASSWORD"));
  assert.match(workflow, /PAYUNI_ENV: sandbox/); assert.doesNotMatch(workflow, /secrets\.DATABASE_URL|Production|\bcheckout\/admission\b/);
  assert.match(workflow, /sudo iptables -P OUTPUT DROP/); assert.match(workflow, /sudo ip6tables -P OUTPUT DROP/);
  assert.match(workflow, /trap restore_network EXIT/); assert.match(workflow, /key === 'host'/);
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/q1-original-refund\/completion.json/);
  for (const file of workflow.match(/(?:scripts|src\/lib)\/[\w.-]+\.(?:ts|mjs)/g) ?? []) assert.doesNotThrow(() => readFileSync(file));
});
test("actual credential-free CLI emits only closed configuration failure with no writes", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/q1-original-refund-runner.mjs"], {
    encoding: "utf8", timeout: 15000, env: { SystemRoot: process.platform === "win32" ? "C:\\Windows" : "", PATH: "" } });
  assert.equal(result.status, 1); const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.status, "BLOCKED"); assert.equal(receipt.stage, "configuration");
  assert.equal(receipt.paymentSubmitted, false); assert.equal(receipt.refundSubmissionMayHaveOccurred, false);
  assert.equal(receipt.reservationWritten, false); assert.equal(receipt.productionOperations, false);
  assert.equal(receipt.alternateTransactionSelected, false);
});
test("actual TypeScript runtime adapters expose required named functions under the CLI loader", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "const a=await import('./scripts/q1-original-refund-target.ts');const b=await import('./src/lib/staging-qa-finance-bootstrap.ts');const x=a.default??a,y=b.default??b; if(typeof x.readOriginalRefundTarget!=='function'||typeof x.reserveOriginalRefund!=='function'||typeof y.qaFinanceDatabaseUrl!=='function'||typeof y.verifyQaFinanceCertificate!=='function')process.exit(2);"],
  { encoding: "utf8", timeout: 15000, env: { SystemRoot: process.platform === "win32" ? "C:\\Windows" : "", PATH: "" } });
  assert.equal(result.status, 0);
});
test("readonly verify mode has explicit input and a bounded refund-step budget", () => {
  assert.match(workflow, /verify_only:[\s\S]*?type: boolean/);
  assert.match(workflow, /Q1_ORIGINAL_REFUND_VERIFY_ONLY: \$\{\{ inputs.verify_only \}\}/);
  assert.match(workflow, /timeout-minutes: 30/); assert.match(workflow, /timeout-minutes: 20\s+shell: bash/);
});