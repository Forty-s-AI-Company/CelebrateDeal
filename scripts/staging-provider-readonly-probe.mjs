import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const PREVIEW_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/u;
const PROBE_RESULTS = new Set(["ok", "not_configured", "invalid_configuration", "unauthorized", "forbidden", "not_found", "provider_error", "network_error", "invalid_response"]);
const R2_FIELDS = ["accountId", "accessKeyId", "secretAccessKey", "bucket", "publicBaseUrl"];
const STREAM_FIELDS = ["accountId", "token", "webhookSecret"];

function fixedPresence(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || fields.some((field) => typeof value[field] !== "boolean")) return null;
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

/** Run only after protected GitHub deployment lineage has been checked. */
export async function runStagingProviderProbe(env = process.env, fetchImpl = fetch) {
  const receipt = {
    schemaVersion: "celebratedeal-staging-provider-readonly-probe/v1",
    sourceSha: SOURCE_SHA.test(env.CELEBRATEDEAL_SOURCE_SHA ?? "") ? env.CELEBRATEDEAL_SOURCE_SHA : null,
    status: "BLOCKED",
    reason: "INVALID_BINDING",
    r2: "not_run",
    stream: "not_run",
    r2Configured: null,
    streamConfigured: null,
    nonProductionScope: "unverified",
  };
  if (!receipt.sourceSha || !PREVIEW_HOST.test(env.CELEBRATEDEAL_DEPLOYMENT_HOST ?? "")
    || typeof env.JOB_SECRET !== "string" || env.JOB_SECRET.length < 16) return receipt;

  try {
    const response = await fetchImpl(`https://${env.CELEBRATEDEAL_DEPLOYMENT_HOST}/api/admin/ops/provider-runtime?probe=read-only`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.JOB_SECRET}`,
        "x-celebratedeal-source-sha": receipt.sourceSha,
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200 || response.headers.get("location")) {
      await response.body?.cancel().catch(() => undefined);
      receipt.reason = "HTTP_REJECTED";
      return receipt;
    }
    const body = await response.json();
    const r2Configured = fixedPresence(body?.r2?.configured, R2_FIELDS);
    const streamConfigured = fixedPresence(body?.stream?.configured, STREAM_FIELDS);
    if (body?.evidence !== "provider_read_only_probe" || body.providerProbe !== "completed"
      || body.nonProductionScope !== "unverified"
      || !PROBE_RESULTS.has(body.probe?.r2) || !PROBE_RESULTS.has(body.probe?.stream)
      || !r2Configured || !streamConfigured) {
      receipt.reason = "RESPONSE_REJECTED";
      return receipt;
    }
    receipt.r2 = body.probe.r2;
    receipt.stream = body.probe.stream;
    // Runtime presence is safe to report; account, bucket, token and digest values are not.
    receipt.r2Configured = r2Configured;
    receipt.streamConfigured = streamConfigured;
    receipt.status = receipt.r2 === "ok" && receipt.stream === "ok" ? "REACHABLE_SCOPE_UNVERIFIED" : "BLOCKED";
    receipt.reason = receipt.status === "BLOCKED" ? "PROVIDER_NOT_REACHABLE" : "NONE";
    return receipt;
  } catch {
    receipt.reason = "REQUEST_FAILED";
    return receipt;
  }
}

async function main() {
  const receipt = await runStagingProviderProbe();
  const serialized = `${JSON.stringify(receipt)}\n`;
  if (process.env.RUNNER_TEMP) {
    await writeFile(`${process.env.RUNNER_TEMP}/celebratedeal-staging-provider-readonly-probe.json`, serialized, { mode: 0o600 });
  }
  process.stdout.write(serialized);
  process.exitCode = receipt.status === "REACHABLE_SCOPE_UNVERIFIED" ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
