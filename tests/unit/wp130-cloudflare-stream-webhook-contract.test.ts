import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fakeDb, fakeCapture } = vi.hoisted(() => ({
  fakeDb: {
    video: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  fakeCapture: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => fakeDb,
}));

vi.mock("@/lib/monitoring", () => ({
  captureOperationalError: fakeCapture,
}));

import { POST } from "@/app/api/cloudflare/stream-webhook/route";
import { createCloudflareStreamWebhookHandler } from "@/lib/cloudflare-stream-webhook-handler";

const SECRET = "wp130-synthetic-secret";
const UID = "wp130-synthetic-stream-uid";

function signature(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
  return `time=${timestamp},sig1=${digest}`;
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://wp130.invalid/api/cloudflare/stream-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Webhook-Signature": signature(body),
      ...headers,
    },
    body,
  });
}

function handler() {
  return createCloudflareStreamWebhookHandler({ db: fakeDb as never });
}

function matchedVideo(initialStatus = "processing") {
  const stored = {
    id: "video-wp130",
    vendorId: "vendor-wp130",
    status: initialStatus,
    cloudflareReadyToStream: initialStatus === "ready",
    cloudflarePlaybackId: initialStatus === "ready" ? UID : null,
    videoUrl: `https://videodelivery.net/${UID}/manifest/video.m3u8`,
    thumbnailUrl: null,
    durationSec: initialStatus === "ready" ? 43 : 0,
    estimatedMinutes: initialStatus === "ready" ? 1 : 0,
  };
  fakeDb.video.findMany.mockImplementation(async () => [{ ...stored }]);
  fakeDb.video.findUnique.mockImplementation(async () => ({
    id: stored.id,
    vendorId: stored.vendorId,
    status: stored.status,
  }));
  fakeDb.video.updateMany.mockImplementation(async ({ where, data }: {
    where: { id: string; vendorId: string; status: string };
    data: Record<string, unknown>;
  }) => {
    if (where.id !== stored.id || where.vendorId !== stored.vendorId || where.status !== stored.status) {
      return { count: 0 };
    }
    Object.assign(stored, data);
    return { count: 1 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("VERCEL_ENV", "production");
  matchedVideo();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("WP-130 Cloudflare Stream webhook contract", () => {
  it("exports the Next route and keeps an injectable handler factory outside the route module", () => {
    expect(typeof POST).toBe("function");
    expect(typeof createCloudflareStreamWebhookHandler).toBe("function");
  });

  it("fails closed for a missing signature without touching persistence", async () => {
    const body = JSON.stringify({ uid: UID, readyToStream: true });
    const response = await handler()(new Request("https://wp130.invalid/api/cloudflare/stream-webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ reason: "missing_webhook_signature" });
    expect(fakeDb.video.findMany).not.toHaveBeenCalled();
  });

  it("rejects an invalid official signature without touching persistence", async () => {
    const body = JSON.stringify({ uid: UID, readyToStream: true });
    const response = await handler()(request(body, {
      "Webhook-Signature": "time=1700000000,sig1=deadbeef",
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ reason: expect.stringMatching(/invalid|expired/) });
    expect(fakeDb.video.findMany).not.toHaveBeenCalled();
  });

  it("accepts a valid signed payload and performs one deterministic transition", async () => {
    const body = JSON.stringify({ uid: UID, readyToStream: true, duration: 42.6 });
    const response = await handler()(request(body));
    const payload = await response.json() as { ok: boolean; updated: number; verificationMode: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, updated: 1, verificationMode: "official-signature" });
    expect(fakeDb.video.updateMany).toHaveBeenCalledTimes(1);
    expect(fakeDb.video.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "video-wp130", vendorId: "vendor-wp130", status: "processing" },
      data: expect.objectContaining({ durationSec: 43, estimatedMinutes: 1 }),
    }));
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toContain(body);
  });

  it("rejects malformed JSON and missing required fields before persistence", async () => {
    const malformed = "{";
    const malformedResponse = await handler()(request(malformed));
    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toEqual({ error: "Invalid Cloudflare Stream webhook JSON" });

    const missingField = JSON.stringify({ readyToStream: true });
    const missingFieldResponse = await handler()(request(missingField));
    expect(missingFieldResponse.status).toBe(400);
    await expect(missingFieldResponse.json()).resolves.toEqual({ error: "Invalid Cloudflare Stream webhook payload" });
    expect(fakeDb.video.findMany).not.toHaveBeenCalled();
  });

  it("rejects unsupported status and ambiguous UID without writes", async () => {
    const unsupportedBody = JSON.stringify({ uid: UID, status: { state: "future-provider-state" } });
    const unsupportedResponse = await handler()(request(unsupportedBody));
    expect(unsupportedResponse.status).toBe(400);

    fakeDb.video.findMany.mockResolvedValueOnce([
      { id: "video-a", status: "processing" },
      { id: "video-b", status: "processing" },
    ]);
    const ambiguousBody = JSON.stringify({ uid: UID, readyToStream: true });
    const ambiguousResponse = await handler()(request(ambiguousBody));
    expect(ambiguousResponse.status).toBe(409);
    await expect(ambiguousResponse.json()).resolves.toEqual({ error: "Ambiguous Cloudflare Stream mapping" });
    expect(fakeDb.video.updateMany).not.toHaveBeenCalled();
  });

  it("does not regress a ready video when a stale processing replay arrives", async () => {
    matchedVideo("ready");
    const body = JSON.stringify({ uid: UID, status: { state: "processing" } });
    const response = await handler()(request(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, updated: 0 });
    expect(fakeDb.video.updateMany).not.toHaveBeenCalled();
  });

  it("requires duplicate ready delivery to be idempotent", async () => {
    const body = JSON.stringify({ uid: UID, readyToStream: true });
    const first = await handler()(request(body));
    const second = await handler()(request(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ ok: true, updated: 0 });
    expect(fakeDb.video.updateMany).toHaveBeenCalledTimes(1);
  });

  it("keeps an archived mapping archived while accepting ready metadata", async () => {
    matchedVideo("archived");
    const readyBody = JSON.stringify({ uid: UID, readyToStream: true, duration: 120.2 });
    const readyResponse = await handler()(request(readyBody));
    const duplicateReadyResponse = await handler()(request(readyBody));
    const staleBody = JSON.stringify({ uid: UID, status: { state: "error" } });
    const staleResponse = await handler()(request(staleBody));

    expect(readyResponse.status).toBe(200);
    await expect(readyResponse.json()).resolves.toMatchObject({ ok: true, updated: 1 });
    await expect(duplicateReadyResponse.json()).resolves.toMatchObject({ ok: true, updated: 0 });
    expect(fakeDb.video.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "video-wp130", vendorId: "vendor-wp130", status: "archived" },
      data: expect.objectContaining({ durationSec: 121, estimatedMinutes: 3 }),
    }));
    expect(staleResponse.status).toBe(200);
    await expect(staleResponse.json()).resolves.toMatchObject({ ok: true, updated: 0 });
    expect(fakeDb.video.updateMany).toHaveBeenCalledTimes(1);
  });

  it("returns a fixed retryable response when convergence is exhausted", async () => {
    const contentionHandler = createCloudflareStreamWebhookHandler({
      db: fakeDb as never,
      converge: async () => ({ outcome: "contention_exhausted" }),
      captureError: fakeCapture,
    });
    const body = JSON.stringify({ uid: UID, readyToStream: true });
    const response = await contentionHandler(request(body));
    const payload = await response.json() as Record<string, string>;

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      error: "Cloudflare Stream webhook update is temporarily unavailable",
      code: "contention_exhausted",
    });
    expect(fakeCapture).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toContain(body);
  });
});
