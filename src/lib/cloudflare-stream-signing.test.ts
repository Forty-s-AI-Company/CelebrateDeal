import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getStreamAllowedOrigins,
  getStreamPlaybackSecurity,
  getStreamSigningConfig,
  parseCloudflareStreamPlaybackUrl,
  signStreamPlaybackUrl,
  STREAM_TOKEN_CLOCK_SKEW_SECONDS,
  STREAM_TOKEN_MAX_LIFETIME_SECONDS,
} from "@/lib/cloudflare-stream-signing";

// Synthetic keys generated per test run; no real signing key is stored in the repository.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pemText = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
const pemBase64 = Buffer.from(pemText, "utf8").toString("base64");
const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" })), "utf8").toString("base64");
const weakPem = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey
  .export({ format: "pem", type: "pkcs8" }).toString();

const keyId = "0123456789abcdef0123456789abcdef";
const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const storedUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;
const now = new Date("2026-11-03T10:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1_000);

const signingEnv = {
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId,
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pemBase64,
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
};

function decodeToken(playbackUrl: string) {
  const token = new URL(playbackUrl).pathname.split("/")[1]!;
  const [header, payload, signature] = token.split(".");
  return {
    token,
    header: JSON.parse(Buffer.from(header!, "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")),
    verified: verify(
      "sha256",
      Buffer.from(`${header}.${payload}`, "utf8"),
      publicKey,
      Buffer.from(signature!, "base64url"),
    ),
  };
}

describe("getStreamSigningConfig", () => {
  it("stays disabled without any signing variable", () => {
    expect(getStreamSigningConfig({})).toEqual({ status: "disabled" });
    expect(getStreamPlaybackSecurity({ NEXT_PUBLIC_APP_URL: "https://app.example.test" })).toBeNull();
  });

  it.each([
    ["key id without key", { CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId }, "partial"],
    ["key without key id", { CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pemBase64 }, "partial"],
    ["both key formats", { ...signingEnv, CLOUDFLARE_STREAM_SIGNING_KEY_JWK: jwkBase64 }, "both_key_formats"],
    ["malformed key id", { ...signingEnv, CLOUDFLARE_STREAM_SIGNING_KEY_ID: "bad id!" }, "invalid_key_id"],
    ["non-key text", { ...signingEnv, CLOUDFLARE_STREAM_SIGNING_KEY_PEM: "not-a-key" }, "invalid_key"],
    ["public key", { ...signingEnv, CLOUDFLARE_STREAM_SIGNING_KEY_PEM: createPublicKey(privateKey).export({ format: "pem", type: "spki" }).toString() }, "invalid_key"],
    ["1024-bit key", { ...signingEnv, CLOUDFLARE_STREAM_SIGNING_KEY_PEM: weakPem }, "weak_key"],
    ["customer code with a host", { ...signingEnv, CLOUDFLARE_STREAM_CUSTOMER_CODE: "customer-abc.cloudflarestream.com" }, "invalid_customer_code"],
  ])("rejects %s", (_name, env, reason) => {
    expect(getStreamSigningConfig(env)).toEqual({ status: "misconfigured", reason });
  });

  it.each([
    ["Cloudflare base64 pem", pemBase64],
    ["PEM text", pemText],
    ["PEM with literal \\n escapes", pemText.replace(/\n/g, "\\n")],
  ])("accepts the key as %s", (_name, pem) => {
    const config = getStreamSigningConfig({ CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId, CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pem });
    expect(config).toMatchObject({ status: "enabled", keyId, customerCode: null });
  });

  it("accepts Cloudflare's base64 JWK instead of PEM", () => {
    expect(getStreamSigningConfig({ CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId, CLOUDFLARE_STREAM_SIGNING_KEY_JWK: jwkBase64 }))
      .toMatchObject({ status: "enabled", keyId });
  });
});

describe("signStreamPlaybackUrl", () => {
  it("returns the stored URL unchanged when signing is not configured", () => {
    expect(signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 600 }, {})).toEqual({ signed: false, playbackUrl: storedUrl });
  });

  it("returns the stored URL unchanged when the signing configuration is unusable", () => {
    expect(signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 600 }, { CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId }))
      .toEqual({ signed: false, playbackUrl: storedUrl });
  });

  it("replaces the video uid with an RS256 token carrying sub, kid, nbf and exp", () => {
    const signed = signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 600 }, signingEnv);
    expect(signed).toMatchObject({ signed: true, expiresAt: new Date((nowSeconds + 600) * 1_000) });
    const playbackUrl = signed!.playbackUrl;
    expect(playbackUrl).toMatch(/^https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/manifest\/video\.m3u8$/);
    expect(playbackUrl).not.toContain(uid);

    const decoded = decodeToken(playbackUrl);
    expect(decoded.header).toEqual({ alg: "RS256", kid: keyId });
    expect(decoded.payload).toEqual({
      sub: uid,
      kid: keyId,
      nbf: nowSeconds - STREAM_TOKEN_CLOCK_SKEW_SECONDS,
      exp: nowSeconds + 600,
    });
    expect(decoded.payload).not.toHaveProperty("accessRules");
    expect(decoded.verified).toBe(true);
  });

  it("produces the same token for the JWK form of the key", () => {
    const fromPem = signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 600 }, signingEnv);
    const fromJwk = signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 600 }, {
      CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId,
      CLOUDFLARE_STREAM_SIGNING_KEY_JWK: jwkBase64,
    });
    expect(fromJwk?.playbackUrl).toBe(fromPem?.playbackUrl);
  });

  it("never issues a token for more than 24 hours", () => {
    const signed = signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 7 * 24 * 60 * 60 }, signingEnv);
    expect(decodeToken(signed!.playbackUrl).payload.exp).toBe(nowSeconds + STREAM_TOKEN_MAX_LIFETIME_SECONDS);
  });

  it("caps exp at notAfter and refuses once notAfter has passed", () => {
    const notAfter = new Date(now.getTime() + 90_000);
    const signed = signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 1_800, notAfter }, signingEnv);
    expect(decodeToken(signed!.playbackUrl).payload.exp).toBe(nowSeconds + 90);
    expect(signed).toMatchObject({ expiresAt: notAfter });

    expect(signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 1_800, notAfter: now }, signingEnv)).toBeNull();
    expect(signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 1_800, notAfter: new Date(now.getTime() - 1) }, signingEnv)).toBeNull();
  });

  it("keeps the customer subdomain and DASH suffix of a stored customer URL", () => {
    const customerUrl = `https://customer-abc123.cloudflarestream.com/${uid}/manifest/video.mpd`;
    const signed = signStreamPlaybackUrl(customerUrl, { now, ttlSeconds: 600 }, signingEnv);
    expect(signed!.playbackUrl).toMatch(/^https:\/\/customer-abc123\.cloudflarestream\.com\/[\w.-]+\/manifest\/video\.mpd$/);
    expect(decodeToken(signed!.playbackUrl).payload.sub).toBe(uid);
  });

  it("serves from the configured customer subdomain when one is set", () => {
    const signed = signStreamPlaybackUrl(storedUrl, { now, ttlSeconds: 600 }, { ...signingEnv, CLOUDFLARE_STREAM_CUSTOMER_CODE: "xyz789" });
    expect(new URL(signed!.playbackUrl).hostname).toBe("customer-xyz789.cloudflarestream.com");
  });

  it.each([
    "https://video.example.test/live.m3u8",
    "https://videodelivery.net.evil.test/a1b2c3d4e5f60718293a4b5c6d7e8f90/manifest/video.m3u8",
    "http://videodelivery.net/a1b2c3d4e5f60718293a4b5c6d7e8f90/manifest/video.m3u8",
    "https://videodelivery.net/not-a-uid/manifest/video.m3u8",
    "https://videodelivery.net/a1b2c3d4e5f60718293a4b5c6d7e8f90/downloads/default.mp4",
    "https://videodelivery.net/a1b2c3d4e5f60718293a4b5c6d7e8f90/manifest/video.m3u8?token=x",
  ])("does not sign a URL that is not a stored Stream playback URL: %s", (url) => {
    expect(parseCloudflareStreamPlaybackUrl(url)).toBeNull();
    expect(signStreamPlaybackUrl(url, { now, ttlSeconds: 600 }, signingEnv)).toEqual({ signed: false, playbackUrl: url });
  });
});

describe("getStreamAllowedOrigins", () => {
  it("derives the app hostname from NEXT_PUBLIC_APP_URL", () => {
    expect(getStreamAllowedOrigins({ NEXT_PUBLIC_APP_URL: "https://App.Example.test/some/path" }))
      .toEqual({ origins: ["app.example.test"], invalid: [] });
  });

  it("keeps a non-default port, which Cloudflare requires for localhost", () => {
    expect(getStreamAllowedOrigins({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).origins).toEqual(["localhost:3000"]);
  });

  it("adds STREAM_ALLOWED_ORIGINS entries, normalizes and de-duplicates them", () => {
    expect(getStreamAllowedOrigins({
      NEXT_PUBLIC_APP_URL: "https://app.example.test",
      STREAM_ALLOWED_ORIGINS: " *.vercel.app , https://staging.example.test/ ,APP.example.test,, preview.example.test:8443",
    })).toEqual({
      origins: ["app.example.test", "*.vercel.app", "staging.example.test", "preview.example.test:8443"],
      invalid: [],
    });
  });

  it("reports entries Cloudflare cannot accept", () => {
    expect(getStreamAllowedOrigins({
      STREAM_ALLOWED_ORIGINS: "example.test/path,*,bad_host.test,ok.example.test,example.test:99999",
    })).toEqual({
      origins: ["ok.example.test"],
      invalid: ["example.test/path", "*", "bad_host.test", "example.test:99999"],
    });
  });

  it("only applies upload restrictions once signing is enabled", () => {
    expect(getStreamPlaybackSecurity({ NEXT_PUBLIC_APP_URL: "https://app.example.test", STREAM_ALLOWED_ORIGINS: "*.vercel.app" })).toBeNull();
    expect(getStreamPlaybackSecurity({ ...signingEnv, STREAM_ALLOWED_ORIGINS: "*.vercel.app" })).toEqual({
      requireSignedURLs: true,
      allowedOrigins: ["app.example.test", "*.vercel.app"],
    });
  });
});
