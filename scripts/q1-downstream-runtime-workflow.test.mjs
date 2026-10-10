import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const workflow=readFileSync('.github/workflows/q1-downstream-runtime.yml','utf8');
test('only protected master injects the existing minimal staging bindings after contracts and lineage',()=>{
 assert.match(workflow,/github.ref == 'refs\/heads\/master' && github.ref_protected/);
 assert.match(workflow,/environment: Preview – celebrate-deal-staging/);
 assert.match(workflow,/persist-credentials: false/);
 assert.ok(workflow.indexOf('Validate downstream readonly contracts')<workflow.indexOf('secrets.STAGING_DATABASE_URL'));
 assert.ok(workflow.indexOf('--verify-lineage')<workflow.indexOf('secrets.JOB_SECRET'));
 assert.doesNotMatch(workflow,/PAYUNI_QA_FINANCE_PASSWORD|PAYUNI_SANDBOX_HASH|PAYUNI_SANDBOX_MERCHANT|secrets\.DATABASE_URL/);
 const files=workflow.match(/(?:scripts|src\/lib)\/[\w.-]+\.(?:ts|mjs)/g)??[];
 for(const file of files) assert.doesNotThrow(()=>readFileSync(file));
 assert.ok(files.includes('scripts/q1-downstream-runtime.test.ts'));
 assert.ok(files.includes('src/lib/q1-downstream-readonly.test.ts'));
});
test('network allowlist and fixed sanitized artifact retain IPv4/IPv6 denial and restoration',()=>{
 assert.match(workflow,/sudo iptables -P OUTPUT DROP/);
 assert.match(workflow,/sudo ip6tables -P OUTPUT DROP/);
 assert.match(workflow,/trap restore_network EXIT/);
 assert.match(workflow,/key === 'host'/);
 assert.match(workflow,/path: \$\{\{ runner.temp \}\}\/q1-downstream-runtime\/completion.json/);
});
test('actual credential-free CLI rejects configuration without side effects',()=>{
 const child=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/q1-downstream-runtime-cli.ts'],{
  encoding:'utf8',timeout:15000,env:{SystemRoot:process.platform==='win32'?'C:\\Windows':'',PATH:''},
 });
 assert.equal(child.status,1);
 const receipt=JSON.parse(child.stdout.trim());
 assert.equal(receipt.stage,'configuration');
 for(const name of ['databaseWrites','paymentSubmitted','refundSubmitted','productionOperations','callbackReplayAuthorized']) assert.equal(receipt[name],false);
 assert.equal(receipt.callbackPosts,0);
});
