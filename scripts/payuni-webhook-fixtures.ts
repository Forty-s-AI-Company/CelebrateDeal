import { config as loadEnv } from "dotenv";
import { buildPayUniSandboxWebhookFixture, type PayUniSandboxFixtureName } from "../src/lib/payment-providers/payuni-fixtures";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type Flags = {
  fixture: PayUniSandboxFixtureName;
  targetUrl: string;
  printCurl: boolean;
  post: boolean;
  vendorId?: string;
  vendorSlug?: string;
  orderNumber?: string;
  eventId?: string;
};

function parseFlags() {
  const args = process.argv.slice(2);
  const fixture = (args[0] ?? "paid") as PayUniSandboxFixtureName;
  const flags: Flags = {
    fixture,
    targetUrl: process.env.TARGET_APP_URL?.replace(/\/$/, "") ?? "http://localhost:31023",
    printCurl: args.includes("--print-curl"),
    post: args.includes("--post"),
  };

  for (let index = 1; index < args.length; index += 1) {
    const value = args[index];
    const next = args[index + 1];
    if (value === "--url" && next) flags.targetUrl = next.replace(/\/$/, "");
    if (value === "--vendor-id" && next) flags.vendorId = next;
    if (value === "--vendor-slug" && next) flags.vendorSlug = next;
    if (value === "--order-number" && next) flags.orderNumber = next;
    if (value === "--event-id" && next) flags.eventId = next;
  }

  return flags;
}

function assertEnv(name: string) {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function main() {
  const flags = parseFlags();
  const merchantId = assertEnv("PAYUNI_MERCHANT_ID");
  const hashKey = assertEnv("PAYUNI_HASH_KEY");
  const hashIv = assertEnv("PAYUNI_HASH_IV");

  const body = buildPayUniSandboxWebhookFixture({
    fixture: flags.fixture,
    merchantId,
    hashKey,
    hashIv,
    overrides: {
      ...(flags.vendorId ? { VendorId: flags.vendorId } : {}),
      ...(flags.vendorSlug ? { VendorSlug: flags.vendorSlug } : {}),
      ...(flags.orderNumber ? { MerTradeNo: flags.orderNumber } : {}),
      ...(flags.eventId ? { EventId: flags.eventId } : {}),
    },
  });

  const endpoint = `${flags.targetUrl}/api/webhooks/payments?provider=payuni`;
  const curlCommand = `curl -X POST "${endpoint}" -H "Content-Type: application/x-www-form-urlencoded" --data-raw "${body}"`;

  if (flags.printCurl || !flags.post) {
    console.log(curlCommand);
  }

  if (!flags.post) {
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  console.log(JSON.stringify({
    fixture: flags.fixture,
    endpoint,
    status: response.status,
    body: text,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
