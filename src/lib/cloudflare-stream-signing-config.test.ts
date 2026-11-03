import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getStreamAllowedOrigins,
  getStreamLockSecurity,
  getStreamPlaybackSecurity,
  getStreamSigningConfig,
  getStreamUploadLockFlag,
} from "@/lib/cloudflare-stream-signing-config";

// Synthetic keys generated per test run; no real signing key is stored in the repository.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pemText = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
const pemBase64 = Buffer.from(pemText, "utf8").toString("base64");
const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" })), "utf8").toString("base64");
const weakPem = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey
  .export({ format: "pem", type: "pkcs8" }).toString();

const keyId = "0123456789abcdef0123456789abcdef";
const signingEnv = {
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: keyId,
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pemBase64,
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
};

describe("getStreamSigningConfig", () => {
  it("stays disabled without any signing variable", () => {
    expect(getStreamSigningConfig({})).toEqual({ status: "disabled" });
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
});

describe("upload lock and batch lock security", () => {
  it.each([
    [undefined, "off"],
    ["false", "off"],
    ["TRUE", "on"],
    ["yes", "invalid"],
  ] as const)("reads CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS=%s as %s", (value, flag) => {
    expect(getStreamUploadLockFlag({ CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS: value })).toBe(flag);
  });

  it("locks new uploads only with signing enabled and the separate flag on", () => {
    const env = { ...signingEnv, STREAM_ALLOWED_ORIGINS: "*.vercel.app" };
    expect(getStreamPlaybackSecurity({ ...env, CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS: "true", CLOUDFLARE_STREAM_SIGNING_KEY_PEM: undefined })).toBeNull();
    expect(getStreamPlaybackSecurity(env)).toBeNull();
    expect(getStreamPlaybackSecurity({ ...env, CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS: "true" })).toEqual({
      requireSignedURLs: true,
      allowedOrigins: ["app.example.test", "*.vercel.app"],
    });
  });

  it("allows the batch lock as soon as signing is enabled, independent of the upload flag", () => {
    expect(getStreamLockSecurity({})).toBeNull();
    expect(getStreamLockSecurity(signingEnv)).toEqual({ requireSignedURLs: true, allowedOrigins: ["app.example.test"] });
  });
});
