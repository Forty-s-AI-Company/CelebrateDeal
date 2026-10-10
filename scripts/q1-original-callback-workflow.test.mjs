import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = readFileSync('.github/workflows/q1-original-callback.yml', 'utf8');
test('only protected master injects minimal staging credentials after contracts and lineage', () => {
  assert.match(workflow, /github.ref == 'refs\/heads\/master' && github.ref_protected/);
  assert.match(workflow, /environment: Preview – celebrate-deal-staging/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /STAGING_DATABASE_URL: \$\{\{ secrets.STAGING_DATABASE_URL \}\}/);
  assert.match(workflow, /JOB_SECRET: \$\{\{ secrets.JOB_SECRET \}\}/);
  assert.doesNotMatch(workflow, /PAYUNI_QA_FINANCE_PASSWORD|PAYUNI_SANDBOX_HASH|PAYUNI_SANDBOX_MERCHANT|secrets\.DATABASE_URL/);
  assert.ok(workflow.indexOf('Validate fixed original callback contract') < workflow.indexOf('secrets.STAGING_DATABASE_URL'));
  assert.ok(workflow.indexOf('--verify-lineage') < workflow.indexOf('secrets.STAGING_DATABASE_URL'));
  for (const file of workflow.match(/(?:scripts|src\/lib)\/[\w.-]+\.(?:ts|mjs)/g) ?? []) assert.doesNotThrow(() => readFileSync(file));
});
test('fixed sanitized artifact and IPv4/IPv6 deny-by-default restoration remain', () => {
  assert.match(workflow, /sudo iptables -P OUTPUT DROP/);
  assert.match(workflow, /sudo ip6tables -P OUTPUT DROP/);
  assert.match(workflow, /trap restore_network EXIT/);
  assert.match(workflow, /key === 'host'/);
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/q1-original-callback\/completion.json/);
});
test('actual credential-free CLI rejects configuration with no side effects', () => {
  const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/q1-original-callback-cli.ts'], {
    encoding: 'utf8', timeout: 15000, env: { SystemRoot: process.platform === 'win32' ? 'C:\\Windows' : '', PATH: '' },
  });
  assert.equal(r.status, 1);
  const receipt = JSON.parse(r.stdout.trim());
  assert.equal(receipt.stage, 'configuration');
  assert.equal(receipt.callbackPosts, 0);
  assert.equal(receipt.possibleDatabaseWrites, false);
  assert.equal(receipt.paymentSubmitted, false);
  assert.equal(receipt.refundSubmitted, false);
  assert.equal(receipt.productionOperations, false);
});
