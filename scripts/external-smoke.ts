import { config as loadEnv } from "dotenv";
import { buildPayUniSandboxWebhookFixture } from "../src/lib/payment-providers/payuni-fixtures";
import { getStreamVideoStatus } from "../src/lib/cloudflare-stream";
import { createCloudflareStreamWebhookSignature } from "../src/lib/cloudflare-webhook-signature";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

type SmokeResult = {
  name: string;
  status: "pass" | "skip" | "fail";
  detail: string;
};

const baseUrl = (process.env.TARGET_APP_URL ?? "http://localhost:31023").replace(/\/$/, "");
const jobSecret = process.env.JOB_SECRET;
const results: SmokeResult[] = [];
const requiredChecks = new Set(
  (process.env.REQUIRED_SMOKE_CHECKS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const sampleVideoUrl = "https://storage.googleapis.com/stream-example-bucket/video.mp4";

function record(result: SmokeResult) {
  results.push(result);
  const prefix = result.status === "pass" ? "PASS" : result.status === "skip" ? "SKIP" : "FAIL";
  console.log(`[${prefix}] ${result.name}: ${result.detail}`);
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  return text ? { rawText: text } : null;
}

function formatPayload(payload: unknown) {
  if (!payload) {
    return "empty response";
  }
  if (typeof payload === "string") {
    return payload;
  }
  return JSON.stringify(payload);
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
}

async function request(path: string, init?: RequestInit) {
  if (!baseUrl) {
    throw new Error("TARGET_APP_URL is required.");
  }

  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(jobSecret ? { Authorization: `Bearer ${jobSecret}` } : {}),
      ...init?.headers,
    },
  });
}

async function checkJson(name: string, path: string, init?: RequestInit) {
  try {
    const response = await request(path, init);
    const body = await readResponsePayload(response);
    if (!response.ok || body.ok === false) {
      record({ name, status: "fail", detail: `HTTP ${response.status}: ${formatPayload(body)}` });
      return;
    }
    record({ name, status: "pass", detail: `HTTP ${response.status}` });
  } catch (error) {
    record({ name, status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
}

async function main() {
  await checkJson("health", "/api/health");
  await checkJson("admin preflight", "/api/admin/preflight");

  if (process.env.SMOKE_TEST_EMAIL) {
    await checkJson("resend test email", "/api/admin/ops/test-email", {
      method: "POST",
      body: JSON.stringify({ to: process.env.SMOKE_TEST_EMAIL }),
    });
  } else {
    record({ name: "resend test email", status: "skip", detail: "SMOKE_TEST_EMAIL not set" });
  }

  await checkJson("posthog smoke event", "/api/admin/ops/test-analytics", { method: "POST" });
  await checkJson("sentry smoke event", "/api/admin/ops/test-monitoring", { method: "POST" });

  if (process.env.RUN_CLOUDFLARE_SMOKE === "true") {
    const vendorId = process.env.SMOKE_VENDOR_ID;
    if (!vendorId) {
      record({ name: "cloudflare mutating smoke", status: "skip", detail: "SMOKE_VENDOR_ID not set" });
    } else {
      await runCloudflareSmoke(vendorId);
    }
  } else {
    record({ name: "cloudflare mutating smoke", status: "skip", detail: "Set RUN_CLOUDFLARE_SMOKE=true to create direct upload and live input" });
  }

  if (process.env.RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE === "true") {
    await runPayUniSmoke();
  } else {
    record({ name: "payuni sandbox webhook", status: "skip", detail: "Set RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE=true to replay paid / refunded / duplicate fixtures" });
  }

  if (process.env.RUN_DEMO_PAYMENT_WEBHOOK_SMOKE === "true") {
    const vendorId = process.env.SMOKE_VENDOR_ID;
    const vendorSlug = process.env.SMOKE_VENDOR_SLUG;
    const productId = process.env.SMOKE_PRODUCT_ID;
    if (!vendorId || !vendorSlug || !productId) {
      record({ name: "demo payment webhook", status: "fail", detail: "SMOKE_VENDOR_ID, SMOKE_VENDOR_SLUG, and SMOKE_PRODUCT_ID are required" });
    } else {
      const checkoutResponse = await fetch(`${baseUrl}/api/payments/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl, "X-CelebrateDeal-Client": "web" },
        body: JSON.stringify({ vendorId, productId }),
      });
      const checkoutPayload = await readResponsePayload(checkoutResponse);
      if (!checkoutResponse.ok || !isRecord(checkoutPayload) || checkoutPayload.provider !== "demo" || typeof checkoutPayload.orderNumber !== "string" || typeof checkoutPayload.amountCents !== "number") {
        record({ name: "demo payment checkout setup", status: "fail", detail: `HTTP ${checkoutResponse.status}: ${formatPayload(checkoutPayload)}` });
      } else {
        record({ name: "demo payment checkout setup", status: "pass", detail: `transaction=${String(checkoutPayload.transactionId)}` });
        const orderNumber = checkoutPayload.orderNumber;
        const amountCents = checkoutPayload.amountCents;
        await checkJson("demo paid webhook", "/api/webhooks/payments", {
          method: "POST",
          headers: { "x-payment-provider": "demo" },
          body: JSON.stringify({
            eventId: `evt-${orderNumber}`,
            eventType: "paid",
            vendorSlug,
            orderNumber,
            grossAmountCents: amountCents,
            gatewayFeeCents: 20,
            platformFeeCents: 10,
          }),
        });
        await checkJson("demo refund webhook", "/api/webhooks/payments", {
          method: "POST",
          headers: { "x-payment-provider": "demo" },
          body: JSON.stringify({
            eventId: `evt-refund-${orderNumber}`,
            eventType: "refunded",
            vendorSlug,
            orderNumber,
            refundAmountCents: amountCents,
            refundReason: "smoke test",
          }),
        });
      }
    }
  } else {
    record({ name: "demo payment webhook", status: "skip", detail: "Set RUN_DEMO_PAYMENT_WEBHOOK_SMOKE=true and SMOKE_VENDOR_SLUG to create test transactions" });
  }

  const requiredFailures = [...requiredChecks].filter((name) => {
    const result = results.find((item) => item.name === name);
    return !result || result.status !== "pass";
  });
  if (requiredFailures.length > 0) {
    console.error(`[FAIL] required smoke checks did not pass: ${requiredFailures.join(", ")}`);
  }

  if (results.some((result) => result.status === "fail") || requiredFailures.length > 0) {
    process.exitCode = 1;
  }
}

async function runCloudflareSmoke(vendorId: string) {
  try {
    const directUploadResponse = await request("/api/admin/ops/cloudflare/direct-upload", {
      method: "POST",
      body: JSON.stringify({ vendorId, title: `Smoke upload ${Date.now()}`, maxDurationSeconds: 600 }),
    });
    const directUploadBody = await readResponsePayload(directUploadResponse);
    if (!directUploadResponse.ok || !directUploadBody?.upload?.uploadURL || !directUploadBody?.upload?.uid) {
      record({
        name: "cloudflare direct upload",
        status: "fail",
        detail: `HTTP ${directUploadResponse.status}: ${formatPayload(directUploadBody)}`,
      });
      return;
    }
    record({ name: "cloudflare direct upload", status: "pass", detail: directUploadBody.upload.uid });

    const sampleResponse = await fetch(sampleVideoUrl);
    if (!sampleResponse.ok) {
      record({ name: "cloudflare sample video fetch", status: "fail", detail: `HTTP ${sampleResponse.status}` });
      return;
    }
    const sampleBytes = await sampleResponse.arrayBuffer();
    const uploadForm = new FormData();
    uploadForm.set("file", new Blob([sampleBytes], { type: "video/mp4" }), "sample-video.mp4");
    const uploadResponse = await fetch(directUploadBody.upload.uploadURL, {
      method: "POST",
      body: uploadForm,
    });
    if (!uploadResponse.ok) {
      record({ name: "cloudflare upload file", status: "fail", detail: `HTTP ${uploadResponse.status}` });
      return;
    }
    record({ name: "cloudflare upload file", status: "pass", detail: `HTTP ${uploadResponse.status}` });

    const readyDetails = await pollUntilReady(directUploadBody.upload.uid);
    record({ name: "cloudflare stream ready", status: "pass", detail: readyDetails.playback?.hls ?? "readyToStream=true" });

    const signedWebhookBody = JSON.stringify({
      uid: directUploadBody.upload.uid,
      readyToStream: true,
      thumbnail: readyDetails.thumbnail,
      duration: readyDetails.duration,
      playback: readyDetails.playback,
      status: {
        state: "ready",
        pctComplete: "100.000000",
      },
    });
    const webhookTimestamp = Math.floor(Date.now() / 1000);
    const webhookSecret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET ?? "";
    const webhookSignature = createCloudflareStreamWebhookSignature({
      body: signedWebhookBody,
      secret: webhookSecret,
      timestamp: webhookTimestamp,
    });
    const webhookResponse = await fetch(`${baseUrl}/api/cloudflare/stream-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Webhook-Signature": `time=${webhookTimestamp},sig1=${webhookSignature}`,
      },
      body: signedWebhookBody,
    });
    const webhookResult = await readResponsePayload(webhookResponse);
    if (!webhookResponse.ok || (isRecord(webhookResult) && webhookResult.ok === false)) {
      record({
        name: "cloudflare ready webhook replay",
        status: "fail",
        detail: `HTTP ${webhookResponse.status}: ${formatPayload(webhookResult)}`,
      });
      return;
    }
    record({ name: "cloudflare ready webhook replay", status: "pass", detail: JSON.stringify(webhookResult) });

    const liveInputResponse = await request("/api/admin/ops/cloudflare/live-input", {
      method: "POST",
      body: JSON.stringify({ vendorId, name: `CelebrateDeal smoke ${new Date().toISOString()}` }),
    });
    const liveInputBody = await readResponsePayload(liveInputResponse);
    if (!liveInputResponse.ok || !liveInputBody?.liveInput?.uid) {
      record({
        name: "cloudflare live input",
        status: "fail",
        detail: `HTTP ${liveInputResponse.status}: ${formatPayload(liveInputBody)}`,
      });
      return;
    }
    const hasPlaintextStreamKey = Object.prototype.hasOwnProperty.call(liveInputBody.liveInput, "streamKey");
    if (hasPlaintextStreamKey || !liveInputBody.liveInput.streamKeyRef) {
      record({ name: "cloudflare live input", status: "fail", detail: "stream key exposure detected" });
      return;
    }
    record({ name: "cloudflare live input", status: "pass", detail: `streamKeyRef=${liveInputBody.liveInput.streamKeyRef}` });
  } catch (error) {
    record({ name: "cloudflare mutating smoke", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
}

async function pollUntilReady(uid: string) {
  const timeoutAt = Date.now() + 180_000;
  while (Date.now() < timeoutAt) {
    const details = await getStreamVideoStatus(uid);
    if (details.readyToStream) {
      return details;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Cloudflare video ${uid} did not reach readyToStream within timeout.`);
}

async function runPayUniSmoke() {
  const merchantId = process.env.PAYUNI_MERCHANT_ID;
  const hashKey = process.env.PAYUNI_HASH_KEY;
  const hashIv = process.env.PAYUNI_HASH_IV;
  if (!merchantId || !hashKey || !hashIv) {
    record({ name: "payuni sandbox webhook", status: "skip", detail: "PAYUNI sandbox env is incomplete" });
    return;
  }

  const vendorId = process.env.SMOKE_VENDOR_ID;
  const vendorSlug = process.env.SMOKE_VENDOR_SLUG;
  const productId = process.env.SMOKE_PRODUCT_ID;
  if (!vendorId || !productId) {
    record({ name: "payuni sandbox webhook", status: "skip", detail: "SMOKE_VENDOR_ID and SMOKE_PRODUCT_ID are required to create a pending checkout" });
    return;
  }

  const checkoutResponse = await fetch(`${baseUrl}/api/payments/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
      "X-CelebrateDeal-Client": "web",
    },
    body: JSON.stringify({ vendorId, productId }),
  });
  const checkoutPayload = await readResponsePayload(checkoutResponse);
  if (!checkoutResponse.ok || !isRecord(checkoutPayload) || typeof checkoutPayload.orderNumber !== "string" || typeof checkoutPayload.amountCents !== "number") {
    record({ name: "payuni sandbox checkout setup", status: "fail", detail: `HTTP ${checkoutResponse.status}: ${formatPayload(checkoutPayload)}` });
    return;
  }
  if (checkoutPayload.provider !== "payuni") {
    record({ name: "payuni sandbox checkout setup", status: "fail", detail: `Expected payuni provider, received ${String(checkoutPayload.provider)}` });
    return;
  }
  record({ name: "payuni sandbox checkout setup", status: "pass", detail: `transaction=${String(checkoutPayload.transactionId)}` });

  const orderNumber = checkoutPayload.orderNumber;
  const tradeAmount = checkoutPayload.amountCents / 100;
  const fixtures = [
    { name: "payuni paid webhook", fixture: "paid" as const, eventId: `${orderNumber}-paid` },
    { name: "payuni duplicate webhook", fixture: "duplicate_paid" as const, eventId: `${orderNumber}-paid` },
    { name: "payuni refunded webhook", fixture: "refunded" as const, eventId: `${orderNumber}-refund` },
  ];

  for (const item of fixtures) {
    try {
      const body = buildPayUniSandboxWebhookFixture({
        fixture: item.fixture,
        merchantId,
        hashKey,
        hashIv,
        overrides: {
          ...(vendorId ? { VendorId: vendorId } : {}),
          ...(vendorSlug ? { VendorSlug: vendorSlug } : {}),
          MerTradeNo: orderNumber,
          EventId: item.eventId,
          TradeAmt: tradeAmount,
          ...(item.fixture === "refunded" ? { RefundAmount: tradeAmount } : {}),
        },
      });
      const response = await fetch(`${baseUrl}/api/webhooks/payments?provider=payuni`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const payload = await readResponsePayload(response);
      if (!response.ok) {
        record({ name: item.name, status: "fail", detail: `HTTP ${response.status}: ${formatPayload(payload)}` });
        continue;
      }
      record({ name: item.name, status: "pass", detail: formatPayload(payload) });
    } catch (error) {
      record({ name: item.name, status: "fail", detail: error instanceof Error ? error.message : String(error) });
    }
  }
}

main();
