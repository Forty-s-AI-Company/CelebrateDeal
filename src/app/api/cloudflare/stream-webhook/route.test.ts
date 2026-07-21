import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { POST } from "@/app/api/cloudflare/stream-webhook/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/api-security";
import { buildCloudflareStreamWebhookFixture } from "@/lib/cloudflare-webhook-fixtures";

const createdVendorIds: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

function cloudflareSignatureHeader(body: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `time=${timestamp},sig1=${signature}`;
}

async function createProcessingVideo(uid: string) {
  const vendor = await getDb().vendor.create({
    data: {
      name: "Stream Test Vendor",
      slug: `stream-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      email: `stream-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`,
      passwordHash: "test",
    },
  });
  createdVendorIds.push(vendor.id);
  const video = await getDb().video.create({
    data: {
      vendorId: vendor.id,
      title: "Processing Video",
      sourceType: "cloudflare_stream",
      videoUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
      status: "processing",
      cloudflareStreamUid: uid,
    },
  });

  return { vendor, video };
}

describe("Cloudflare Stream webhook", () => {
  it("fails closed before database access when the webhook secret is not configured", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", undefined);
    const body = JSON.stringify({ uid: "cf_uid_disabled", readyToStream: true });

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Webhook-Signature": cloudflareSignatureHeader(body, "unused-fixture-secret"),
      },
      body,
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ reason: "missing_webhook_signing_secret" });
    await expect(getDb().video.findFirst({
      where: { cloudflareStreamUid: "cf_uid_disabled" },
    })).resolves.toBeNull();
  });

  it("rejects oversized payloads before signature verification or database access", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_JSON_BODY_BYTES + 1),
        "Webhook-Signature": "time=1,sig1=not-a-signature",
      },
      body: "{}",
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "Cloudflare Stream webhook payload too large" });
  });

  it("updates video ready status and playback mapping with shared secret fallback", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    vi.stubEnv("VERCEL_ENV", "preview");
    const { video } = await createProcessingVideo("cf_uid_test");

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cloudflare-stream-webhook-secret": "stream-secret",
      },
      body: JSON.stringify({
        uid: "cf_uid_test",
        readyToStream: true,
        thumbnail: "https://example.test/thumb.jpg",
        duration: 91.6,
      }),
    }));

    const updated = await getDb().video.findUniqueOrThrow({ where: { id: video.id } });
    const body = await response.json() as { verificationMode: string };
    expect(response.status).toBe(200);
    expect(body.verificationMode).toBe("shared-secret-fallback");
    expect(updated.status).toBe("ready");
    expect(updated.cloudflareReadyToStream).toBe(true);
    expect(updated.cloudflarePlaybackId).toBe("cf_uid_test");
    expect(updated.durationSec).toBe(92);
  });

  it("accepts official Webhook-Signature", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    vi.stubEnv("VERCEL_ENV", "production");
    const { video } = await createProcessingVideo("cf_uid_signed");
    const body = JSON.stringify({
      uid: "cf_uid_signed",
      readyToStream: true,
      thumbnail: "https://example.test/signed-thumb.jpg",
      duration: 31.2,
    });

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Webhook-Signature": cloudflareSignatureHeader(body, "stream-secret"),
      },
      body,
    }));

    const payload = await response.json() as { verificationMode: string };
    const updated = await getDb().video.findUniqueOrThrow({ where: { id: video.id } });
    expect(response.status).toBe(200);
    expect(payload.verificationMode).toBe("official-signature");
    expect(updated.status).toBe("ready");
    expect(updated.durationSec).toBe(31);
  });

  it("rejects invalid official signatures without falling back", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    vi.stubEnv("VERCEL_ENV", "production");
    const { video } = await createProcessingVideo("cf_uid_invalid");
    const body = JSON.stringify({ uid: "cf_uid_invalid", readyToStream: true });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", "wrong-secret").update(`${timestamp}.${body}`).digest("hex");

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Webhook-Signature": `time=${timestamp},sig1=${signature}`,
        "x-cloudflare-stream-webhook-secret": "stream-secret",
      },
      body,
    }));
    const payload = await response.json() as { reason: string };
    const updated = await getDb().video.findUniqueOrThrow({ where: { id: video.id } });

    expect(response.status).toBe(401);
    expect(payload.reason).toBe("invalid_signature");
    expect(updated.status).toBe("processing");
  });

  it("rejects shared secret fallback in production", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    vi.stubEnv("VERCEL_ENV", "production");
    const { video } = await createProcessingVideo("cf_uid_production_fallback");

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cloudflare-stream-webhook-secret": "stream-secret",
      },
      body: JSON.stringify({ uid: "cf_uid_production_fallback", readyToStream: true }),
    }));

    const payload = await response.json() as { reason: string };
    const updated = await getDb().video.findUniqueOrThrow({ where: { id: video.id } });
    expect(response.status).toBe(401);
    expect(payload.reason).toBe("missing_webhook_signature");
    expect(updated.status).toBe("processing");
  });

  it("accepts signed processing payloads", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    const { video } = await createProcessingVideo("cf_uid_processing");
    const fixture = buildCloudflareStreamWebhookFixture({
      fixture: "processing",
      uid: "cf_uid_processing",
      secret: "stream-secret",
    });

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: fixture.headers,
      body: fixture.body,
    }));

    const updated = await getDb().video.findUniqueOrThrow({ where: { id: video.id } });
    expect(response.status).toBe(200);
    expect(updated.status).toBe("processing");
    expect(updated.cloudflareReadyToStream).toBe(false);
  });

  it("accepts signed error payloads", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    const { video } = await createProcessingVideo("cf_uid_error");
    const fixture = buildCloudflareStreamWebhookFixture({
      fixture: "error",
      uid: "cf_uid_error",
      secret: "stream-secret",
    });

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: fixture.headers,
      body: fixture.body,
    }));

    const updated = await getDb().video.findUniqueOrThrow({ where: { id: video.id } });
    expect(response.status).toBe(200);
    expect(updated.status).toBe("error");
    expect(updated.cloudflareReadyToStream).toBe(false);
  });

  it("rejects signed unknown states without changing the mapped video", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    const { video } = await createProcessingVideo("cf_uid_unknown_state");
    const body = JSON.stringify({
      uid: "cf_uid_unknown_state",
      readyToStream: false,
      status: { state: "provider-added-state" },
    });

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Webhook-Signature": cloudflareSignatureHeader(body, "stream-secret"),
      },
      body,
    }));

    const updated = await getDb().video.findUniqueOrThrow({ where: { id: video.id } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unsupported Cloudflare Stream status" });
    expect(updated.status).toBe("processing");
    expect(updated.cloudflareReadyToStream).toBe(false);
  });

  it("fails closed when a provider UID maps to videos from multiple tenants", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    const first = await createProcessingVideo("cf_uid_collision");
    const second = await createProcessingVideo("cf_uid_collision");
    const body = JSON.stringify({ uid: "cf_uid_collision", readyToStream: true });

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Webhook-Signature": cloudflareSignatureHeader(body, "stream-secret"),
      },
      body,
    }));

    const videos = await getDb().video.findMany({
      where: { id: { in: [first.video.id, second.video.id] } },
      orderBy: { id: "asc" },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Ambiguous Cloudflare Stream mapping" });
    expect(videos).toHaveLength(2);
    expect(videos.every((video) => video.status === "processing")).toBe(true);
    expect(videos.every((video) => video.cloudflareReadyToStream === false)).toBe(true);
  });

  it("rejects replayed official signatures with expired timestamps", async () => {
    vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "stream-secret");
    const body = JSON.stringify({ uid: "cf_uid_replay", readyToStream: true });
    const expiredTimestamp = Math.floor(Date.now() / 1000) - 10 * 60;

    const response = await POST(new Request("https://app.example.test/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Webhook-Signature": cloudflareSignatureHeader(body, "stream-secret", expiredTimestamp),
      },
      body,
    }));
    const payload = await response.json() as { reason: string };

    expect(response.status).toBe(401);
    expect(payload.reason).toBe("expired_timestamp");
  });
});
