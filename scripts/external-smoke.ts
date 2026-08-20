import { buildPayUniSandboxWebhookFixture } from "../src/lib/payment-providers/payuni-fixtures";
import {
  resolveSmokeTarget,
  summarizeSmokeFailure,
  summarizeSmokeResponse,
} from "./external-smoke-safety";

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

async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  return text || null;
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
    if (!response.ok || (isRecord(body) && body.ok === false)) {
      record({
        name,
        status: "fail",
        detail: summarizeSmokeResponse({ status: response.status, ok: response.ok, payload: body }),
      });
      return;
    }
    record({
      name,
      status: "pass",
      detail: summarizeSmokeResponse({ status: response.status, ok: response.ok, payload: body }),
    });
  } catch (error) {
    record({ name, status: "fail", detail: summarizeSmokeFailure(error) });
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
    const upload = isRecord(directUploadBody) && isRecord(directUploadBody.upload) ? directUploadBody.upload : null;
    if (
      !directUploadResponse.ok ||
      !upload ||
      typeof upload.uploadURL !== "string" ||
      typeof upload.uid !== "string"
    ) {
      record({
        name: "cloudflare direct upload",
        status: "fail",
        detail: summarizeSmokeResponse({
          status: directUploadResponse.status,
          ok: directUploadResponse.ok,
          payload: directUploadBody,
        }),
      });
      return;
    }
    record({
      name: "cloudflare direct upload",
      status: "pass",
      detail: `${summarizeSmokeResponse({
        status: directUploadResponse.status,
        ok: directUploadResponse.ok,
        payload: directUploadBody,
      })}; direct_upload=present`,
    });

    const sampleResponse = await fetch(sampleVideoUrl);
    if (!sampleResponse.ok) {
      record({ name: "cloudflare sample video fetch", status: "fail", detail: `HTTP ${sampleResponse.status}` });
      return;
    }
    const sampleBytes = await sampleResponse.arrayBuffer();
    const uploadForm = new FormData();
    uploadForm.set("file", new Blob([sampleBytes], { type: "video/mp4" }), "sample-video.mp4");
    const uploadResponse = await fetch(upload.uploadURL, {
      method: "POST",
      body: uploadForm,
    });
    if (!uploadResponse.ok) {
      record({ name: "cloudflare upload file", status: "fail", detail: `HTTP ${uploadResponse.status}` });
      return;
    }
    record({ name: "cloudflare upload file", status: "pass", detail: `HTTP ${uploadResponse.status}` });

    const videoId = isRecord(directUploadBody) && typeof directUploadBody.videoId === "string" ? directUploadBody.videoId : null;
    if (!videoId) {
      record({ name: "cloudflare webhook ready mapping", status: "fail", detail: "videoId missing" });
      return;
    }
    const readyDetails = await pollUntilReady(videoId);
    record({
      name: "cloudflare webhook ready mapping",
      status: "pass",
      detail: `ready=${String(readyDetails.ready)}, duration_present=${String(readyDetails.durationPresent)}`,
    });

    const liveInputResponse = await request("/api/admin/ops/cloudflare/live-input", {
      method: "POST",
      body: JSON.stringify({
        ...(vendorId ? { vendorId } : {}),
        name: `CelebrateDeal smoke ${new Date().toISOString()}`,
      }),
    });
    const liveInputBody = await readResponsePayload(liveInputResponse);
    const liveInput = isRecord(liveInputBody) && isRecord(liveInputBody.liveInput) ? liveInputBody.liveInput : null;
    if (!liveInputResponse.ok || !liveInput || typeof liveInput.uid !== "string") {
      record({
        name: "cloudflare live input",
        status: "fail",
        detail: summarizeSmokeResponse({
          status: liveInputResponse.status,
          ok: liveInputResponse.ok,
          payload: liveInputBody,
        }),
      });
      return;
    }
    const hasPlaintextStreamKey = Object.prototype.hasOwnProperty.call(liveInput, "streamKey");
    const hasStreamKeyRef = typeof liveInput.streamKeyRef === "string" && liveInput.streamKeyRef.length > 0;
    if (hasPlaintextStreamKey || !hasStreamKeyRef) {
      record({ name: "cloudflare live input", status: "fail", detail: "stream key exposure detected" });
      return;
    }
    record({
      name: "cloudflare live input",
      status: "pass",
      detail: `${summarizeSmokeResponse({
        status: liveInputResponse.status,
        ok: liveInputResponse.ok,
        payload: liveInputBody,
      })}; live_input=present; plaintext_stream_key=false; stream_key_ref=present`,
    });
  } catch (error) {
    record({ name: "cloudflare mutating smoke", status: "fail", detail: summarizeSmokeFailure(error) });
  }
}

async function pollUntilReady(videoId: string) {
  const timeoutAt = Date.now() + 180_000;
  while (Date.now() < timeoutAt) {
    const response = await request(`/api/admin/ops/cloudflare/direct-upload?videoId=${encodeURIComponent(videoId)}`);
    const payload = await readResponsePayload(response);
    const video = isRecord(payload) && isRecord(payload.video) ? payload.video : null;
    if (!response.ok || !video) {
      throw new Error(summarizeSmokeResponse({ status: response.status, ok: response.ok, payload }));
    }
    if (video.readyToStream === true) {
      return {
        ready: true,
        durationPresent: typeof video.durationSec === "number" && Number.isFinite(video.durationSec),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Cloudflare video did not reach readyToStream within timeout.");
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
        record({
          name: item.name,
          status: "fail",
          detail: summarizeSmokeResponse({ status: response.status, ok: response.ok, payload }),
        });
        continue;
      }
      record({
        name: item.name,
        status: "pass",
        detail: summarizeSmokeResponse({ status: response.status, ok: response.ok, payload }),
      });
    } catch (error) {
      record({ name: item.name, status: "fail", detail: summarizeSmokeFailure(error) });
    }
  }
}

main();
