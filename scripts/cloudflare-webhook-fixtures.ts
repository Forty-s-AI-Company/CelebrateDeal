import { config as loadEnv } from "dotenv";
import {
  buildCloudflareStreamWebhookFixture,
  type CloudflareStreamWebhookFixture,
} from "../src/lib/cloudflare-webhook-fixtures";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const baseUrl = (process.env.TARGET_APP_URL ?? "http://localhost:31023").replace(/\/$/, "");
const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
const fixtureArg = process.argv[2] as CloudflareStreamWebhookFixture | undefined;
const allFixtures: CloudflareStreamWebhookFixture[] = [
  "ready",
  "processing",
  "error",
  "invalid_signature",
  "expired_timestamp",
];

async function readPayload(response: Response) {
  const text = await response.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function replay(fixture: CloudflareStreamWebhookFixture) {
  if (!secret) {
    throw new Error("CLOUDFLARE_STREAM_WEBHOOK_SECRET is required.");
  }

  const { body, headers, expectedStatus } = buildCloudflareStreamWebhookFixture({
    fixture,
    uid: `cf_fixture_${fixture}`,
    secret,
  });
  const response = await fetch(`${baseUrl}/api/cloudflare/stream-webhook`, {
    method: "POST",
    headers,
    body,
  });
  const payload = await readPayload(response);
  const ok = response.status === expectedStatus;
  const prefix = ok ? "PASS" : "FAIL";
  console.log(`[${prefix}] ${fixture}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  if (!ok) {
    process.exitCode = 1;
  }
}

async function main() {
  const fixtures = fixtureArg ? [fixtureArg] : allFixtures;
  for (const fixture of fixtures) {
    if (!allFixtures.includes(fixture)) {
      throw new Error(`Unknown fixture: ${fixture}`);
    }
    await replay(fixture);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
