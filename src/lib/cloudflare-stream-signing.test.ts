import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseCloudflareStreamUrl,
  signedVideoUrlOrNull,
  signVideoUrl,
  STREAM_TOKEN_CLOCK_SKEW_SECONDS,
  STREAM_TOKEN_MAX_LIFETIME_SECONDS,
  type SignableVideo,
} from "@/lib/cloudflare-stream-signing";

// Synthetic keys generated per test run; no real signing key is stored in the repository.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pemBase64 = Buffer.from(privateKey.export({ format: "pem", type: "pkcs1" }).toString(), "utf8").toString("base64");
const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" })), "utf8").toString("base64");

const keyId = "0123456789abcdef0123456789abcdef";
const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const otherUid = "f0e1d2c3b4a5968778695a4b3c2d1e0f";
const storedUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;
const now = new Date("2026-11-03T10:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

const signingEnv = {
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId,
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pemBase64,
};

function video(overrides: Partial<SignableVideo> = {}): SignableVideo {
  return {
    vendorId: "vendor-1",
    sourceType: "cloudflare_stream",
    videoUrl: storedUrl,
    thumbnailUrl: `https://customer-abc123.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=2s`,
    cloudflareStreamUid: uid,
    cloudflarePlaybackId: uid,
    cloudflareLiveInputUid: null,
    ...overrides,
  };
}

const options = { vendorId: "vendor-1", now, ttlSeconds: 600 };

function decodeToken(url: string) {
  const token = new URL(url).pathname.split("/")[1]!;
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")),
    verified: verify("sha256", Buffer.from(`${header}.${payload}`, "utf8"), publicKey, Buffer.from(signature!, "base64url")),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("signVideoUrl", () => {
  it("returns the stored URL unchanged when signing is not configured", () => {
    expect(signVideoUrl(video(), options, {})).toEqual({ signed: false, url: storedUrl });
  });

  it("returns the stored URL unchanged and warns once, without key material, when the configuration is unusable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = { CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId, CLOUDFLARE_STREAM_SIGNING_KEY_PEM: "placeholder-key-material" };
    expect(signVideoUrl(video(), options, env)).toEqual({ signed: false, url: storedUrl });
    expect(signVideoUrl(video(), options, env)).toEqual({ signed: false, url: storedUrl });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("stream_signing_misconfigured", { reason: "invalid_key" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("placeholder-key-material");
  });

  it("replaces the bound uid with an RS256 token carrying sub, kid, nbf and exp", () => {
    const signed = signVideoUrl(video(), options, signingEnv);
    expect(signed).toMatchObject({ signed: true, expiresAt: new Date((nowSeconds + 600) * 1_000) });
    expect(signed!.url).toMatch(/^https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/manifest\/video\.m3u8$/);
    expect(signed!.url).not.toContain(uid);

    const decoded = decodeToken(signed!.url);
    expect(decoded.header).toEqual({ alg: "RS256", kid: keyId });
    expect(decoded.payload).toEqual({ sub: uid, kid: keyId, nbf: nowSeconds - STREAM_TOKEN_CLOCK_SKEW_SECONDS, exp: nowSeconds + 600 });
    expect(decoded.verified).toBe(true);
  });

  it("signs a live input URL with the live input uid of the same row", () => {
    const liveUrl = `https://videodelivery.net/${otherUid}/manifest/video.m3u8`;
    const signed = signVideoUrl(video({
      sourceType: "cloudflare_live",
      videoUrl: liveUrl,
      cloudflareStreamUid: null,
      cloudflarePlaybackId: null,
      cloudflareLiveInputUid: otherUid,
    }), options, signingEnv);
    expect(decodeToken(signed!.url).payload.sub).toBe(otherUid);
  });

  it("produces the same token for the JWK form of the key", () => {
    const fromPem = signVideoUrl(video(), options, signingEnv);
    const fromJwk = signVideoUrl(video(), options, { CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId, CLOUDFLARE_STREAM_SIGNING_KEY_JWK: jwkBase64 });
    expect(fromJwk?.url).toBe(fromPem?.url);
  });

  it("never issues a token for more than 24 hours", () => {
    const signed = signVideoUrl(video(), { ...options, ttlSeconds: 7 * 24 * 60 * 60 }, signingEnv);
    expect(decodeToken(signed!.url).payload.exp).toBe(nowSeconds + STREAM_TOKEN_MAX_LIFETIME_SECONDS);
  });

  it("caps exp at notAfter and refuses once notAfter has passed", () => {
    const notAfter = new Date(now.getTime() + 90_000);
    const signed = signVideoUrl(video(), { ...options, ttlSeconds: 1_800, notAfter }, signingEnv);
    expect(decodeToken(signed!.url).payload.exp).toBe(nowSeconds + 90);
    expect(signed).toMatchObject({ expiresAt: notAfter });
    expect(signVideoUrl(video(), { ...options, notAfter: now }, signingEnv)).toBeNull();
  });

  it("serves from the configured customer subdomain when one is set", () => {
    const signed = signVideoUrl(video(), options, { ...signingEnv, CLOUDFLARE_STREAM_CUSTOMER_CODE: "xyz789" });
    expect(new URL(signed!.url).hostname).toBe("customer-xyz789.cloudflarestream.com");
  });

  it("signs a thumbnail and keeps its query", () => {
    const signed = signVideoUrl(video(), { ...options, kind: "thumbnail" }, signingEnv);
    expect(signed!.url).toMatch(/^https:\/\/customer-abc123\.cloudflarestream\.com\/[\w-]+\.[\w-]+\.[\w-]+\/thumbnails\/thumbnail\.jpg\?time=2s$/);
    expect(decodeToken(signed!.url).payload.sub).toBe(uid);
  });

  // B1: tenant binding comes from the row, never from a URL alone.
  it("never signs a merchant-entered url video, even when it holds a Stream URL", () => {
    expect(signVideoUrl(video({ sourceType: "url" }), options, signingEnv)).toEqual({ signed: false, url: storedUrl });
    expect(signVideoUrl(video({ sourceType: "url", cloudflareStreamUid: null, cloudflarePlaybackId: null }), options, signingEnv))
      .toEqual({ signed: false, url: storedUrl });
  });

  it("does not sign when the URL uid differs from the uids stored on the row", () => {
    const foreignUrl = `https://videodelivery.net/${otherUid}/manifest/video.m3u8`;
    expect(signVideoUrl(video({ videoUrl: foreignUrl }), options, signingEnv)).toEqual({ signed: false, url: foreignUrl });
    expect(signVideoUrl(video({ cloudflareStreamUid: null, cloudflarePlaybackId: null }), options, signingEnv))
      .toEqual({ signed: false, url: storedUrl });
  });

  it("refuses a row owned by another vendor", () => {
    expect(signVideoUrl(video({ vendorId: "vendor-2" }), options, signingEnv)).toBeNull();
  });

  it.each([
    "https://video.example.test/live.m3u8",
    `https://videodelivery.net.evil.test/${uid}/manifest/video.m3u8`,
    `http://videodelivery.net/${uid}/manifest/video.m3u8`,
    `https://videodelivery.net/${uid}/downloads/default.mp4`,
    `https://videodelivery.net/${uid}/manifest/video.m3u8?token=x`,
  ])("does not sign a URL that is not a Stream playback URL: %s", (url) => {
    expect(parseCloudflareStreamUrl(url, "playback")).toBeNull();
    expect(signVideoUrl(video({ videoUrl: url }), options, signingEnv)).toEqual({ signed: false, url });
  });
});

describe("signedVideoUrlOrNull", () => {
  it("returns null for a missing row or another vendor's row", () => {
    expect(signedVideoUrlOrNull(null, { vendorId: "vendor-1" })).toBeNull();
    expect(signedVideoUrlOrNull(video({ vendorId: "vendor-2" }), { vendorId: "vendor-1" })).toBeNull();
  });

  it("returns the stored URL when signing is off and null for an empty thumbnail", () => {
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", undefined);
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", undefined);
    vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_JWK", undefined);
    expect(signedVideoUrlOrNull(video(), { vendorId: "vendor-1" })).toBe(storedUrl);
    expect(signedVideoUrlOrNull(video({ thumbnailUrl: null }), { vendorId: "vendor-1", kind: "thumbnail" })).toBeNull();
  });
});
