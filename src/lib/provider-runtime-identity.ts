import { createHmac } from "node:crypto";

function present(value: string | undefined) {
  return Boolean(value?.trim());
}

function fingerprint(secret: string, kind: string, values: Array<string | undefined>) {
  if (values.some((value) => !present(value))) return null;

  // Domain separation keeps different provider identities from sharing a digest.
  return createHmac("sha256", secret)
    .update(JSON.stringify(["provider-runtime-identity-v1", kind, ...values.map((value) => value!.trim())]))
    .digest("hex");
}

/** Report runtime bindings only; this does not contact a provider or establish resource scope. */
export function getProviderRuntimeIdentity(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.JOB_SECRET;
  if (!secret) throw new Error("JOB_SECRET is required for provider runtime identity");

  const r2 = {
    accountId: present(env.CLOUDFLARE_R2_ACCOUNT_ID),
    accessKeyId: present(env.CLOUDFLARE_R2_ACCESS_KEY_ID),
    secretAccessKey: present(env.CLOUDFLARE_R2_SECRET_ACCESS_KEY),
    bucket: present(env.CLOUDFLARE_R2_BUCKET),
    publicBaseUrl: present(env.CLOUDFLARE_R2_PUBLIC_BASE_URL),
  };
  const stream = {
    accountId: present(env.CLOUDFLARE_ACCOUNT_ID),
    token: present(env.CLOUDFLARE_STREAM_TOKEN),
    webhookSecret: present(env.CLOUDFLARE_STREAM_WEBHOOK_SECRET),
  };

  return {
    evidence: "runtime_configuration_only" as const,
    providerProbe: "not_run" as const,
    nonProductionScope: "unverified" as const,
    r2: {
      configured: r2,
      resourceDigest: fingerprint(secret, "r2-account-bucket", [
        env.CLOUDFLARE_R2_ACCOUNT_ID,
        env.CLOUDFLARE_R2_BUCKET,
      ]),
    },
    stream: {
      configured: stream,
      resourceDigest: fingerprint(secret, "stream-account", [env.CLOUDFLARE_ACCOUNT_ID]),
    },
  };
}
