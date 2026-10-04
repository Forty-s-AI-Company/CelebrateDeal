import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { assessR2Binding, attest } from './staging-provider-binding-attestation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const account = 'a'.repeat(32);
const safe = Object.freeze({
  CLOUDFLARE_R2_ACCOUNT_ID: account,
  STAGING_R2_EXPECTED_ACCOUNT_ID: account,
  CLOUDFLARE_R2_BUCKET: 'celebratedeal-staging-assets',
  STAGING_R2_EXPECTED_BUCKET: 'celebratedeal-staging-assets',
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'fixture-access-key',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'fixture-secret-key',
});

test('rejects missing, mismatched, and production-looking bindings before any request', async () => {
  const cases = [
    [{ ...safe, CLOUDFLARE_R2_SECRET_ACCESS_KEY: '' }, 'BINDING_MISSING'],
    [{ ...safe, STAGING_R2_EXPECTED_ACCOUNT_ID: 'b'.repeat(32) }, 'IDENTITY_MISMATCH'],
    [{ ...safe, CLOUDFLARE_R2_BUCKET: 'celebratedeal-prod-assets', STAGING_R2_EXPECTED_BUCKET: 'celebratedeal-prod-assets' }, 'NON_PRODUCTION_BUCKET_NOT_PROVEN'],
    [{ ...safe, CLOUDFLARE_R2_BUCKET: 'celebratedeal-prod-staging', STAGING_R2_EXPECTED_BUCKET: 'celebratedeal-prod-staging' }, 'NON_PRODUCTION_BUCKET_NOT_PROVEN'],
    [{ ...safe, CLOUDFLARE_R2_ACCOUNT_ID: 'bad.example.com' }, 'IDENTITY_FORMAT_INVALID'],
  ];
  for (const [env, reason] of cases) {
    let calls = 0;
    const receipt = await attest(env, async () => { calls += 1; });
    assert.equal(receipt.result, 'BLOCKED');
    assert.equal(receipt.reason, reason);
    assert.equal(calls, 0);
    assert.equal(receipt.identityDigest, null);
  }
});

test('read-only success records provider identity digest and no credential values', async () => {
  let calls = 0;
  const receipt = await attest(safe, async (config) => {
    calls += 1;
    assert.equal(config.accountId, account);
    assert.equal(config.bucket, safe.CLOUDFLARE_R2_BUCKET);
  });
  assert.equal(calls, 1);
  assert.equal(receipt.result, 'PASS');
  assert.equal(receipt.readOnlyOperation, 'HeadBucket');
  assert.match(receipt.identityDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(receipt.stream, 'NOT_ATTESTED');
  assert.equal(receipt.writes, 0);
  const serialized = JSON.stringify(receipt);
  for (const value of [account, safe.CLOUDFLARE_R2_BUCKET, safe.CLOUDFLARE_R2_ACCESS_KEY_ID, safe.CLOUDFLARE_R2_SECRET_ACCESS_KEY]) {
    assert.equal(serialized.includes(value), false);
  }
});

test('provider failure is sanitized and never reported as pass', async () => {
  const receipt = await attest(safe, async () => { throw new Error('fixture-secret-key and customer data'); });
  assert.equal(receipt.result, 'BLOCKED');
  assert.equal(receipt.reason, 'READ_PERMISSION_OR_CONNECTIVITY_FAILED');
  assert.equal(receipt.readRequestSucceeded, false);
  assert.doesNotMatch(JSON.stringify(receipt), /fixture-secret-key|customer data/u);
  assert.equal(assessR2Binding(safe).ok, true);
});

test('workflow is manual, protected Preview only, and injects only fixed R2 bindings', () => {
  const source = readFileSync(path.join(root, '.github/workflows/staging-provider-binding-attestation.yml'), 'utf8');
  const workflow = yaml.load(source);
  assert.ok(workflow.on.workflow_dispatch !== undefined);
  assert.equal(Object.keys(workflow.jobs).length, 1);
  const job = workflow.jobs['attest-r2'];
  assert.match(job.if, /refs\/heads\/master.*github\.ref_protected/u);
  assert.equal(job.environment, 'Preview – celebrate-deal-staging');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const step = job.steps.find((entry) => entry.id === 'attest');
  assert.ok(step);
  assert.equal(step.env.CLOUDFLARE_R2_BUCKET, '${{ vars.CLOUDFLARE_R2_BUCKET }}');
  assert.equal(step.env.STAGING_R2_EXPECTED_BUCKET, '${{ vars.STAGING_R2_EXPECTED_BUCKET }}');
  assert.deepEqual(Object.keys(step.env).sort(), [
    'CLOUDFLARE_R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCOUNT_ID', 'CLOUDFLARE_R2_BUCKET',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'STAGING_PROVIDER_RECEIPT_PATH',
    'STAGING_R2_EXPECTED_ACCOUNT_ID', 'STAGING_R2_EXPECTED_BUCKET',
  ].sort());
  assert.doesNotMatch(source, /pull_request_target|workflow_call|toJSON\(secrets\)|CLOUDFLARE_STREAM_TOKEN|PutObject|DeleteObject|ListObjects/u);
  assert.ok(job.steps.findIndex((entry) => entry.name === 'Upload sanitized attestation receipt') > job.steps.indexOf(step));
  assert.ok(job.steps.findIndex((entry) => entry.name === 'Enforce attestation result') > job.steps.indexOf(step));
});
