import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";
import { beginLineLogin, completeLineLogin, LineFetchLoginProvider, type LineLoginProvider } from "@/lib/line-login";

function testDatabase() {
  let savedAttempt: Record<string, unknown> | null = null;
  const identity = {
    id: "identity-1",
    vendorId: "vendor-1",
    subjectType: "promoter",
    subjectId: "affiliate-1",
    revokedAt: null,
  };
  const credentials = protectLineOfficialAccountCredentials("vendor-1", {
    messagingChannelId: "2000123456",
    messagingChannelSecret: "messaging-secret-1234567890",
    messagingAccessToken: "access-token-with-at-least-thirty-two-characters",
    loginChannelId: "2000654321",
    loginChannelSecret: "login-secret-1234567890",
  });
  const account = { id: "account-1", vendorId: "vendor-1", status: "active", ...credentials };
  const tx = {
    lineLoginState: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    lineUserIdentity: {
      findUnique: vi.fn().mockResolvedValue(identity),
      upsert: vi.fn().mockResolvedValue(identity),
    },
  };
  const db = {
    lineOfficialAccount: { findUnique: vi.fn().mockResolvedValue(account) },
    lineLoginState: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        savedAttempt = { ...data, consumedAt: null, vendor: { id: "vendor-1" } };
        return savedAttempt;
      }),
      findUnique: vi.fn(async () => savedAttempt),
    },
    lineUserIdentity: { findUnique: vi.fn() },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  return { db, tx, getSavedAttempt: () => savedAttempt };
}

describe("LINE Login lifecycle", () => {
  beforeEach(() => {
    vi.stubEnv("CSRF_SECRET", "line-login-test-secret-that-is-at-least-32-bytes");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://celebratedeal.example");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("creates a short-lived, hashed one-time state and a PKCE authorization URL", async () => {
    const runtime = testDatabase();
    const result = await beginLineLogin(runtime.db as never, {
      vendorId: "vendor-1",
      subjectType: "promoter",
      subjectId: "affiliate-1",
      redirectPath: "//attacker.example",
    }, new Date("2026-09-05T00:00:00Z"));
    const url = new URL(result.authorizationUrl);
    const saved = runtime.getSavedAttempt()!;

    expect(url.origin).toBe("https://access.line.me");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toHaveLength(43);
    expect(saved.stateHash).not.toBe(url.searchParams.get("state"));
    expect(saved.redirectPath).toBe("/dashboard");
    expect(String(saved.codeVerifierEncrypted)).toMatch(/^v1\./u);
  });

  it("verifies the provider identity, consumes state once, and stores no plaintext LINE profile", async () => {
    const runtime = testDatabase();
    const started = await beginLineLogin(runtime.db as never, {
      vendorId: "vendor-1",
      subjectType: "promoter",
      subjectId: "affiliate-1",
      redirectPath: "/affiliate",
    });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const provider: LineLoginProvider = {
      exchangeCode: vi.fn().mockResolvedValue({
        userId: "U1234567890",
        displayName: "測試推廣者",
        pictureUrl: "https://profile.line-scdn.net/example",
      }),
    };
    const result = await completeLineLogin(runtime.db as never, provider, { state, code: "authorization-code" });

    expect(result).toMatchObject({ redirectPath: "/affiliate", login: false });
    expect(runtime.tx.lineLoginState.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ consumedAt: null }),
    }));
    const upsert = runtime.tx.lineUserIdentity.upsert.mock.calls[0]?.[0];
    expect(upsert.create.lineUserIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(upsert.create.lineUserIdEncrypted).toMatch(/^v1\./u);
    expect(JSON.stringify(upsert)).not.toContain("U1234567890");
    expect(JSON.stringify(upsert)).not.toContain("測試推廣者");
  });

  it("exchanges the authorization code and verifies the OIDC token nonce", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id_token: "signed-id-token" }))
      .mockResolvedValueOnce(Response.json({ sub: "U123", name: "Ada", nonce: "nonce-1" }));
    const provider = new LineFetchLoginProvider(fetchImpl);
    await expect(provider.exchangeCode({
      code: "code-1",
      channelId: "channel-1",
      channelSecret: "secret-1",
      redirectUri: "https://celebratedeal.example/api/auth/line/callback",
      codeVerifier: "verifier-1",
      nonce: "nonce-1",
    })).resolves.toEqual({ userId: "U123", displayName: "Ada", pictureUrl: null });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, "https://api.line.me/oauth2/v2.1/token", expect.objectContaining({ method: "POST" }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, "https://api.line.me/oauth2/v2.1/verify", expect.objectContaining({ method: "POST" }));

    const mismatched = new LineFetchLoginProvider(vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id_token: "signed-id-token" }))
      .mockResolvedValueOnce(Response.json({ sub: "U123", nonce: "attacker-nonce" })));
    await expect(mismatched.exchangeCode({
      code: "code-1", channelId: "channel-1", channelSecret: "secret-1",
      redirectUri: "https://celebratedeal.example/api/auth/line/callback",
      codeVerifier: "verifier-1", nonce: "nonce-1",
    })).rejects.toThrow("identity verification failed");
  });
});
