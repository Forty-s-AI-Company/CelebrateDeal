import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const workflow = readFileSync('.github/workflows/q1-schema-recovery.yml', 'utf8');
test('only protected master injects fixed Sandbox query bindings after contracts and lineage', () => {
  assert.match(workflow, /github.ref == 'refs\/heads\/master' && github.ref_protected/);
  assert.match(workflow, /environment: Preview – celebrate-deal-staging/);
  assert.match(workflow, /persist-credentials: false/);
  for (const name of ['STAGING_DATABASE_URL','JOB_SECRET','PAYUNI_SANDBOX_MERCHANT_ID','PAYUNI_SANDBOX_HASH_KEY','PAYUNI_SANDBOX_HASH_IV']) {
    assert.ok(workflow.includes(name + ': ${{ secrets.' + name + ' }}'));
  }
  assert.doesNotMatch(workflow, /PAYUNI_QA_FINANCE_PASSWORD|secrets\.DATABASE_URL/);
  assert.ok(workflow.indexOf('run: npx vitest run') < workflow.indexOf('secrets.STAGING_DATABASE_URL'));
  assert.ok(workflow.indexOf('--verify-lineage') < workflow.indexOf('secrets.STAGING_DATABASE_URL'));
  for (const file of workflow.match(/(?:scripts|src\/lib)\/[\w.-]+\.(?:ts|mjs)/g) ?? []) assert.doesNotThrow(() => readFileSync(file));
});
test('restores restricted IPv4/IPv6 networking and publishes only one fixed sanitized receipt', () => {
  for (const text of ['sudo iptables -P OUTPUT DROP','sudo ip6tables -P OUTPUT DROP','trap restore_network EXIT','sandbox-api.payuni.com.tw','key === \'host\'']) assert.ok(workflow.includes(text));
  assert.match(workflow, /q1-schema-recovery\/completion.json/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /\/api\/jobs\/webhook-retry|--log|dotenv|readFile[^\n]*['"]\.env/);
});
test('credential-free actual CLI rejects configuration without payment/refund/callback effects', () => {
  const r=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/q1-schema-recovery-cli.ts'], {
    encoding:'utf8',timeout:15000,env:{SystemRoot:process.platform==='win32'?'C:\\Windows':'',PATH:''},
  });
  assert.equal(r.status,1); const receipt=JSON.parse(r.stdout.trim());
  assert.equal(receipt.stage,'configuration');
  for (const name of ['possibleDatabaseWrites','paymentSubmitted','refundSubmitted','productionOperations','genericSchedulerCalled']) assert.equal(receipt[name],false);
  assert.equal(receipt.callbackPosts,0);
});
