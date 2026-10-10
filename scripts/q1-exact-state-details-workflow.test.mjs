import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/q1-exact-state-details.yml', 'utf8');
test('only protected main can inject staging database and JOB into fixed readonly runner', () => {
  assert.match(workflow, /github.ref == 'refs\/heads\/master' && github.ref_protected/);
  assert.match(workflow, /environment: Preview – celebrate-deal-staging/);
  assert.match(workflow, /STAGING_DATABASE_URL: \$\{\{ secrets.STAGING_DATABASE_URL \}\}/);
  assert.match(workflow, /JOB_SECRET: \$\{\{ secrets.JOB_SECRET \}\}/);
  assert.doesNotMatch(workflow, /PAYUNI_QA_FINANCE_PASSWORD|PAYUNI_SANDBOX_HASH|PAYUNI_SANDBOX_MERCHANT|secrets\.DATABASE_URL/);
  assert.match(workflow, /q1-exact-state-details-cli.ts/);
  assert.match(workflow, /Validate CLI startup and sanitized receipts before secrets/);
  assert.match(workflow, /persist-credentials: false/);
  for (const file of workflow.match(/(?:scripts|src\/lib)\/[\w.-]+\.(?:ts|mjs)/g) ?? []) assert.doesNotThrow(() => readFileSync(file));
});
test('outbound IPv4 and IPv6 deny-by-default and restoration remain intact', () => {
  assert.match(workflow, /"callbackPosts":0,"callbackReplayAuthorized":false/);
  assert.match(workflow, /sudo iptables -P OUTPUT DROP/);
  assert.match(workflow, /sudo ip6tables -P OUTPUT DROP/);
  assert.match(workflow, /trap restore_network EXIT/);
  assert.match(workflow, /key === 'host'/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/q1-exact-state-details\/completion.json/);
});
test('real credential-free CLI fails closed and emits only a valid sanitized receipt', () => {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/q1-exact-state-details-cli.ts'], {
    encoding: 'utf8', timeout: 15000, env: { SystemRoot: process.platform === 'win32' ? 'C:\\Windows' : '', PATH: '' },
  });
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout.trim());
  assert.equal(receipt.schemaVersion, 'celebratedeal-q1-exact-state-details/v1');
  assert.equal(receipt.status, 'BLOCKED_OR_FAILED');
  assert.equal(receipt.stage, 'configuration');
  assert.equal(receipt.databaseWrites, false);
  assert.equal(receipt.productionOperations, false);
  assert.equal(receipt.paymentSubmitted, false);
});
