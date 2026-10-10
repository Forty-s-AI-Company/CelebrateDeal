import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const workflow=readFileSync('.github/workflows/q1-merchant-schema.yml','utf8');
test('fixed protected migration binds staging DB and readonly authorization after tests and lineage',()=>{
 assert.match(workflow,/github.ref == 'refs\/heads\/master' && github.ref_protected/);
 assert.match(workflow,/environment: Preview – celebrate-deal-staging/);
 assert.ok(workflow.indexOf('q1-merchant-schema.test.ts')<workflow.indexOf('secrets.STAGING_DATABASE_URL'));
 assert.ok(workflow.indexOf('--verify-lineage')<workflow.indexOf('secrets.STAGING_DATABASE_URL'));
 assert.match(workflow,/secrets\.JOB_SECRET/);
 assert.doesNotMatch(workflow,/secrets\.(?:DATABASE_URL|PAYUNI_|PAYUNI_QA_)/);
 for(const file of workflow.match(/(?:scripts|src\/lib)\/[\w.-]+\.(?:ts|mjs)/g)??[]) assert.doesNotThrow(()=>readFileSync(file));
});
test('IPv4 and IPv6 deny policy and sole fixed artifact remain enforced',()=>{
 assert.match(workflow,/sudo iptables -P OUTPUT DROP/);
 assert.match(workflow,/sudo ip6tables -P OUTPUT DROP/);
 assert.match(workflow,/trap restore_network EXIT/);
 assert.match(workflow,/key === 'host'/);
 assert.match(workflow,/path: \$\{\{ runner.temp \}\}\/q1-merchant-schema\/completion.json/);
});
test('actual CLI fails closed without credentials or DDL',()=>{
 const child=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/q1-merchant-schema-cli.ts'],{encoding:'utf8',timeout:15000,env:{SystemRoot:process.platform==='win32'?'C:\\Windows':'',PATH:''}});
 assert.equal(child.status,1); const receipt=JSON.parse(child.stdout.trim());
 assert.equal(receipt.stage,'configuration'); assert.equal(receipt.migrationApplied,false);
 assert.equal(receipt.callbackPosts,0); assert.equal(receipt.productionOperations,false);
});
