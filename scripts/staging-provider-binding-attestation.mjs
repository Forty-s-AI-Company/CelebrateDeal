import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ACCOUNT_ID = /^[a-f0-9]{32}$/u;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const STAGING_MARKER = /(?:^|[.-])(?:staging|preview|test)(?:[.-]|$)/u;
const PRODUCTION_MARKER = /(?:^|[.-])(?:prod|production)(?:[.-]|$)/u;

function digest(value) {
  return `sha256:${createHash('sha256').update(`celebratedeal/staging-provider/v1/${value}`).digest('hex')}`;
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Only a protected Preview workflow should pass this object; never log its values. */
export function assessR2Binding(env) {
  const account = env.CLOUDFLARE_R2_ACCOUNT_ID;
  const bucket = env.CLOUDFLARE_R2_BUCKET;
  const expectedAccount = env.STAGING_R2_EXPECTED_ACCOUNT_ID;
  const expectedBucket = env.STAGING_R2_EXPECTED_BUCKET;
  const accessKey = env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretKey = env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (![account, bucket, expectedAccount, expectedBucket, accessKey, secretKey].every(present)) {
    return { ok: false, reason: 'BINDING_MISSING' };
  }
  if (!ACCOUNT_ID.test(account) || !ACCOUNT_ID.test(expectedAccount)
    || !BUCKET.test(bucket) || !BUCKET.test(expectedBucket)) {
    return { ok: false, reason: 'IDENTITY_FORMAT_INVALID' };
  }
  if (account !== expectedAccount || bucket !== expectedBucket) {
    return { ok: false, reason: 'IDENTITY_MISMATCH' };
  }
  if (!STAGING_MARKER.test(bucket) || PRODUCTION_MARKER.test(bucket)) {
    return { ok: false, reason: 'NON_PRODUCTION_BUCKET_NOT_PROVEN' };
  }
  return { ok: true, reason: null, identityDigest: digest(`r2/${account}/${bucket}`) };
}

export async function attest(env, headBucket) {
  const binding = assessR2Binding(env);
  const receipt = {
    schemaVersion: 'celebratedeal-staging-provider-binding/v1',
    provider: 'cloudflare_r2',
    result: 'BLOCKED',
    reason: binding.reason,
    resourceClass: binding.ok ? 'staging_named_bucket' : 'unknown',
    identityDigest: binding.identityDigest ?? null,
    readOnlyOperation: 'HeadBucket',
    readRequestSucceeded: false,
    stream: 'NOT_ATTESTED',
    writes: 0,
    rawResponsePersisted: false,
  };
  if (!binding.ok) return receipt;
  try {
    // HEAD does not list objects or read their contents. No provider response is persisted.
    await headBucket({
      accountId: env.CLOUDFLARE_R2_ACCOUNT_ID,
      bucket: env.CLOUDFLARE_R2_BUCKET,
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    });
    receipt.result = 'PASS';
    receipt.reason = null;
    receipt.readRequestSucceeded = true;
  } catch {
    receipt.reason = 'READ_PERMISSION_OR_CONNECTIVITY_FAILED';
  }
  return receipt;
}

async function headR2Bucket(config) {
  const { HeadBucketCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 1,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
      abortSignal: AbortSignal.timeout(10_000),
    });
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const receipt = await attest(process.env, headR2Bucket);
  const path = process.env.STAGING_PROVIDER_RECEIPT_PATH;
  if (present(path)) await writeFile(path, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`staging_provider_result=${receipt.result} reason=${receipt.reason ?? 'NONE'}\n`);
  if (receipt.result !== 'PASS') process.exitCode = 2;
}
