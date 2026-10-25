import { describe, expect, it, vi } from "vitest";
import { getTurnstileConfig, TURNSTILE_ACTIONS, TURNSTILE_SITEVERIFY_URL, turnstileErrorCode, turnstileSiteKey, verifyTurnstileToken } from "@/lib/turnstile";

// Cloudflare's documented test keys (always-pass site key / secret). Tests only.
const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const enabledEnv = { NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY, TURNSTILE_SECRET_KEY: TEST_SECRET } as NodeJS.ProcessEnv;

function siteverify(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } }));
}

describe("Turnstile configuration", () => {
  it("uses action names Cloudflare accepts (up to 32 of A-Z a-z 0-9 _ -)", () => {
    for (const action of Object.values(TURNSTILE_ACTIONS)) expect(action).toMatch(/^[A-Za-z0-9_-]{1,32}$/u);
  });

  it("is disabled when neither key is set and misconfigured when only one is", () => {
    expect(getTurnstileConfig({ NODE_ENV: "test" })).toEqual({ status: "disabled" });
    expect(getTurnstileConfig({ NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "  " })).toEqual({ status: "disabled" });
    expect(getTurnstileConfig({ NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY })).toEqual({ status: "misconfigured" });
    expect(getTurnstileConfig({ NODE_ENV: "test", TURNSTILE_SECRET_KEY: TEST_SECRET })).toEqual({ status: "misconfigured" });
    expect(getTurnstileConfig(enabledEnv)).toEqual({ status: "enabled", siteKey: TEST_SITE_KEY, secretKey: TEST_SECRET });
    expect(turnstileSiteKey(enabledEnv)).toBe(TEST_SITE_KEY);
    expect(turnstileSiteKey({ NODE_ENV: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: TEST_SITE_KEY })).toBeNull();
  });
});

describe("Turnstile server verification", () => {
  it("skips verification without calling Cloudflare when Turnstile is not configured", async () => {
    const fetchImpl = vi.fn();
    await expect(verifyTurnstileToken({ token: undefined, action: TURNSTILE_ACTIONS.register, env: { NODE_ENV: "test" }, fetchImpl })).resolves.toEqual({ ok: true, skipped: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when only one key is configured", async () => {
    const fetchImpl = vi.fn();
    await expect(verifyTurnstileToken({ token: "token", action: TURNSTILE_ACTIONS.register, env: { NODE_ENV: "test", TURNSTILE_SECRET_KEY: TEST_SECRET }, fetchImpl })).resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts the secret, token and client address to siteverify and accepts a success", async () => {
    const fetchImpl = siteverify({ success: true, action: TURNSTILE_ACTIONS.register, hostname: "app.example.test" });
    await expect(verifyTurnstileToken({ token: " XXXX.DUMMY.TOKEN.XXXX ", action: TURNSTILE_ACTIONS.register, remoteIp: "203.0.113.7", env: enabledEnv, fetchImpl })).resolves.toEqual({ ok: true, skipped: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({ secret: TEST_SECRET, response: "XXXX.DUMMY.TOKEN.XXXX", remoteip: "203.0.113.7" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts Cloudflare's test-secret response, which carries no action", async () => {
    await expect(verifyTurnstileToken({ token: "XXXX.DUMMY.TOKEN.XXXX", action: TURNSTILE_ACTIONS.resendVerification, env: enabledEnv, fetchImpl: siteverify({ success: true, "error-codes": [] }) })).resolves.toEqual({ ok: true, skipped: false });
  });

  it("refuses a missing or oversized token without calling Cloudflare", async () => {
    const fetchImpl = vi.fn();
    for (const token of [undefined, null, "", "   ", "x".repeat(2_049), 42]) {
      await expect(verifyTurnstileToken({ token, action: TURNSTILE_ACTIONS.register, env: enabledEnv, fetchImpl })).resolves.toEqual({ ok: false, reason: "missing" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a token Cloudflare rejects, or one solved for the other form", async () => {
    await expect(verifyTurnstileToken({ token: "t", action: TURNSTILE_ACTIONS.register, env: enabledEnv, fetchImpl: siteverify({ success: false, "error-codes": ["invalid-input-response"] }) })).resolves.toEqual({ ok: false, reason: "rejected" });
    await expect(verifyTurnstileToken({ token: "t", action: TURNSTILE_ACTIONS.register, env: enabledEnv, fetchImpl: siteverify({ success: true, action: TURNSTILE_ACTIONS.resendVerification }) })).resolves.toEqual({ ok: false, reason: "rejected" });
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
      await expect(verifyTurnstileToken({ token: "t", action: TURNSTILE_ACTIONS.register, env: enabledEnv, fetchImpl })).resolves.toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("maps refusals to the form error codes", () => {
    expect(turnstileErrorCode({ ok: false, reason: "missing" })).toBe("turnstile_failed");
    expect(turnstileErrorCode({ ok: false, reason: "rejected" })).toBe("turnstile_failed");
    expect(turnstileErrorCode({ ok: false, reason: "unavailable" })).toBe("turnstile_unavailable");
  });
});
