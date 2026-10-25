import { describe, expect, it, vi } from "vitest";
import {
  getTurnstileConfig,
  isCloudflareTurnstileTestKey,
  TURNSTILE_ACTIONS,
  TURNSTILE_SITEVERIFY_URL,
  turnstileAllowedHostnames,
  turnstileErrorCode,
  turnstileSiteKey,
  verifyTurnstileToken,
} from "@/lib/turnstile";

// Cloudflare's documented test keys (always-pass site key / secret). Tests only.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
// Synthetic non-test keys, to exercise the production checks without a real widget.
const SITE_KEY = "0x4AAAAAAASyntheticSiteKey";
const SECRET = "0x4AAAAAAASyntheticSecretKeyValue";
const testEnv = { NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "https://app.example.test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET_KEY: TEST_SECRET } as NodeJS.ProcessEnv;
const realEnv = { NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "https://app.example.test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: SECRET } as NodeJS.ProcessEnv;

function siteverify(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } }));
}

const register = TURNSTILE_ACTIONS.register;

describe("Turnstile configuration", () => {
  it("uses action names Cloudflare accepts (up to 32 of A-Z a-z 0-9 _ -)", () => {
    for (const action of Object.values(TURNSTILE_ACTIONS)) expect(action).toMatch(/^[A-Za-z0-9_-]{1,32}$/u);
  });

  it("is disabled when neither key is set and misconfigured when only one is", () => {
    expect(getTurnstileConfig({ NODE_ENV: "test" })).toEqual({ status: "disabled" });
    expect(getTurnstileConfig({ NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "  " })).toEqual({ status: "disabled" });
    expect(getTurnstileConfig({ NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: SITE_KEY })).toEqual({ status: "misconfigured", reason: "partial" });
    expect(getTurnstileConfig({ NODE_ENV: "test", TURNSTILE_SECRET_KEY: SECRET })).toEqual({ status: "misconfigured", reason: "partial" });
    expect(getTurnstileConfig(realEnv)).toEqual({ status: "enabled", siteKey: SITE_KEY, secretKey: SECRET, testSecret: false });
    expect(getTurnstileConfig(testEnv)).toMatchObject({ status: "enabled", testSecret: true });
    expect(turnstileSiteKey(realEnv)).toBe(SITE_KEY);
    expect(turnstileSiteKey({ NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: SITE_KEY })).toBeNull();
  });

  it("recognises Cloudflare's documented test keys and refuses them on a Vercel deployment", () => {
    for (const key of ["1x00000000000000000000AA", "2x00000000000000000000AB", "3x00000000000000000000FF", TEST_SECRET, "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
      expect(isCloudflareTurnstileTestKey(key)).toBe(true);
    }
    expect(isCloudflareTurnstileTestKey(SITE_KEY)).toBe(false);
    for (const VERCEL_ENV of ["preview", "production"]) {
      expect(getTurnstileConfig({ ...testEnv, VERCEL_ENV })).toEqual({ status: "misconfigured", reason: "test_key_on_deployment" });
      expect(getTurnstileConfig({ ...realEnv, NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY, VERCEL_ENV })).toEqual({ status: "misconfigured", reason: "test_key_on_deployment" });
      expect(getTurnstileConfig({ ...realEnv, VERCEL_ENV })).toMatchObject({ status: "enabled" });
    }
  });

  it("accepts tokens only from the canonical host, this preview's own URL and configured extra hosts", () => {
    expect([...turnstileAllowedHostnames(realEnv)]).toEqual(["app.example.test"]);
    expect([...turnstileAllowedHostnames({ ...realEnv, VERCEL_ENV: "preview", VERCEL_URL: "celebrate-deal-staging-abc.vercel.app", TURNSTILE_ALLOWED_HOSTNAMES: " Staging.Example.Test , https://prod.example.test/path ,," })].sort())
      .toEqual(["app.example.test", "celebrate-deal-staging-abc.vercel.app", "prod.example.test", "staging.example.test"]);
    // A VERCEL_URL outside a preview deployment is not trusted.
    expect([...turnstileAllowedHostnames({ ...realEnv, VERCEL_URL: "other.vercel.app" })]).toEqual(["app.example.test"]);
  });
});

describe("Turnstile server verification", () => {
  it("skips verification without calling Cloudflare when Turnstile is not configured", async () => {
    const fetchImpl = vi.fn();
    await expect(verifyTurnstileToken({ token: undefined, action: register, env: { NODE_ENV: "test" }, fetchImpl })).resolves.toEqual({ ok: true, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when only one key is configured, or with test keys on a deployment", async () => {
    const fetchImpl = vi.fn();
    await expect(verifyTurnstileToken({ token: "token", action: register, env: { NODE_ENV: "test", TURNSTILE_SECRET_KEY: SECRET }, fetchImpl })).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(verifyTurnstileToken({ token: "token", action: register, env: { ...testEnv, VERCEL_ENV: "production" }, fetchImpl })).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the secret, token and client address to siteverify and accepts a matching host and action", async () => {
    const fetchImpl = siteverify({ success: true, action: register, hostname: "app.example.test" });
    await expect(verifyTurnstileToken({ token: " XXXX.DUMMY.TOKEN.XXXX ", action: register, remoteIp: "203.0.113.7", env: realEnv, fetchImpl })).resolves.toEqual({ ok: true, skipped: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ secret: SECRET, response: "XXXX.DUMMY.TOKEN.XXXX", remoteip: "203.0.113.7" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses a token solved on another host, or with a missing or different action", async () => {
    const cases = [
      { success: true, action: register, hostname: "evil.example.test" },
      { success: true, action: register },
      { success: true, action: TURNSTILE_ACTIONS.resendVerification, hostname: "app.example.test" },
      { success: true, action: "", hostname: "app.example.test" },
      { success: true, hostname: "app.example.test" },
    ];
    for (const body of cases) {
      await expect(verifyTurnstileToken({ token: "t", action: register, env: realEnv, fetchImpl: siteverify(body) })).resolves.toEqual({ ok: false, reason: "rejected" });
    }
  });

  it("skips the host and action checks only for Cloudflare's test secrets (fixed dummy host, no action)", async () => {
    await expect(verifyTurnstileToken({ token: "XXXX.DUMMY.TOKEN.XXXX", action: register, env: testEnv, fetchImpl: siteverify({ success: true, hostname: "example.com", action: "" }) })).resolves.toEqual({ ok: true, skipped: false });
    await expect(verifyTurnstileToken({ token: "t", action: register, env: testEnv, fetchImpl: siteverify({ success: false, "error-codes": ["invalid-input-response"] }) })).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("refuses a missing or oversized token without calling Cloudflare", async () => {
    const fetchImpl = vi.fn();
    for (const token of [undefined, null, "", "   ", "x".repeat(2_049), 42]) {
      await expect(verifyTurnstileToken({ token, action: register, env: realEnv, fetchImpl })).resolves.toEqual({ ok: false, reason: "missing" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a token Cloudflare rejects", async () => {
    await expect(verifyTurnstileToken({ token: "t", action: register, env: realEnv, fetchImpl: siteverify({ success: false, "error-codes": ["invalid-input-response"] }) })).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("fails closed on network errors, timeouts, HTTP errors and unexpected bodies", async () => {
    const cases = [
      vi.fn(async () => { throw new TypeError("fetch failed"); }),
      vi.fn(async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }),
      siteverify({ success: true }, { status: 500 }),
      vi.fn(async () => new Response("not json", { status: 200 })),
      siteverify({ ok: true }),
      siteverify(null),
    ];
    for (const fetchImpl of cases) {
      await expect(verifyTurnstileToken({ token: "t", action: register, env: realEnv, fetchImpl })).resolves.toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("maps refusals to the form error codes", () => {
    expect(turnstileErrorCode({ ok: false, reason: "missing" })).toBe("turnstile_failed");
    expect(turnstileErrorCode({ ok: false, reason: "rejected" })).toBe("turnstile_failed");
    expect(turnstileErrorCode({ ok: false, reason: "unavailable" })).toBe("turnstile_unavailable");
  });
});
