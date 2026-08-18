import { buildPayUniSandboxWebhookFixture } from "../src/lib/payment-providers/payuni-fixtures";
import { resolveSmokeTarget } from "./external-smoke-safety";

type SmokeResult = {
  name: string;
  status: "pass" | "skip" | "fail";
  detail: string;
};

const baseUrl = resolveSmokeTarget({
  targetAppUrl: process.env.TARGET_APP_URL,
  smokeEnvironment: process.env.SMOKE_ENVIRONMENT,
  allowStagingSmoke: process.env.ALLOW_STAGING_SMOKE,
  expectedHostname: process.env.SMOKE_EXPECTED_HOSTNAME,
});
const jobSecret = process.env.JOB_SECRET;
const results: SmokeResult[] = [];
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

  await checkJson("resend test email", "/api/admin/ops/test-email", {
    method: "POST",
    body: JSON.stringify(process.env.SMOKE_TEST_EMAIL ? { to: process.env.SMOKE_TEST_EMAIL } : {}),
  });

  await checkJson("posthog smoke event", "/api/admin/ops/test-analytics", { method: "POST" });
  await checkJson("sentry smoke event", "/api/admin/ops/test-monitoring", { method: "POST" });

  if (process.env.RUN_CLOUDFLARE_SMOKE === "true") {
    const vendorId = process.env.SMOKE_VENDOR_ID;
    await runCloudflareSmoke(vendorId);
  } else {
    record({ name: "cloudflare mutating smoke", status: "skip", detail: "Set RUN_CLOUDFLARE_SMOKE=true to create direct upload and live input" });
  }

  if (process.env.RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE === "true") {
    await runPayUniSmoke();
  } else {
    record({ name: "payuni sandbox webhook", status: "skip", detail: "Set RUN_PAYUNI_SANDBOX_WEBHOOK_SMOKE=true to replay paid / refunded / duplicate fixtures" });
  }

  if (process.env.RUN_DEMO_PAYMENT_WEBHOOK_SMOKE === "true") {
    const vendorSlug = process.env.SMOKE_VENDOR_SLUG;
    if (!vendorSlug) {
      record({ name: "demo payment webhook", status: "fail", detail: "SMOKE_VENDOR_SLUG is required" });
    } else {
      const orderNumber = `SMOKE-${Date.now()}`;
      await checkJson("demo paid webhook", "/api/webhooks/payments", {
        method: "POST",
        headers: { "x-payment-provider": "demo" },
        body: JSON.stringify({
          eventId: `evt-${orderNumber}`,
          eventType: "paid",
          vendorSlug,
          orderNumber,
          grossAmountCents: 1000,
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
          refundAmountCents: 1000,
          refundReason: "smoke test",
        }),
      });
    }
  } else {
    record({ name: "demo payment webhook", status: "skip", detail: "Set RUN_DEMO_PAYMENT_WEBHOOK_SMOKE=true and SMOKE_VENDOR_SLUG to create test transactions" });
  }

  if (results.some((result) => result.status === "fail")) {
    process.exitCode = 1;
  }
}

async function runCloudflareSmoke(vendorId?: string) {
  try {
    const directUploadResponse = await request("/api/admin/ops/cloudflare/direct-upload", {
      method: "POST",
      body: JSON.stringify({
        ...(vendorId ? { vendorId } : {}),
        title: `Smoke upload ${Date.now()}`,
        maxDurationSeconds: 600,
      }),
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

    if (!directUploadBody.videoId) {
      record({ name: "cloudflare webhook ready mapping", status: "fail", detail: "videoId missing" });
      return;
    }
    const readyDetails = await pollUntilReady(directUploadBody.videoId);
    record({
      name: "cloudflare webhook ready mapping",
      status: "pass",
      detail: `status=${readyDetails.status}, durationSec=${readyDetails.durationSec}`,
    });

    const liveInputResponse = await request("/api/admin/ops/cloudflare/live-input", {
      method: "POST",
      body: JSON.stringify({
        ...(vendorId ? { vendorId } : {}),
        name: `CelebrateDeal smoke ${new Date().toISOString()}`,
      }),
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

async function pollUntilReady(videoId: string) {
  const timeoutAt = Date.now() + 180_000;
  while (Date.now() < timeoutAt) {
    const response = await request(`/api/admin/ops/cloudflare/direct-upload?videoId=${encodeURIComponent(videoId)}`);
    const payload = await readResponsePayload(response);
    if (!response.ok || !isRecord(payload) || !isRecord(payload.video)) {
      throw new Error(`Cloudflare video status failed: HTTP ${response.status}: ${formatPayload(payload)}`);
    }
    if (payload.video.readyToStream === true) {
      return {
        status: String(payload.video.status ?? "ready"),
        durationSec: Number(payload.video.durationSec ?? 0),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Cloudflare video ${videoId} did not reach readyToStream within timeout.`);
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
  const orderNumber = `PAYUNI-SMOKE-${Date.now()}`;
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
