import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkRateLimit: vi.fn(),
  getRequestClientIp: vi.fn(),
  listViewerChatMessages: vi.fn(),
  createViewerChatMessage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/request-client-ip", () => ({ getRequestClientIp: mocks.getRequestClientIp }));
vi.mock("@/lib/live-chat", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-chat")>("@/lib/live-chat");
  return {
    ...actual,
    listViewerChatMessages: mocks.listViewerChatMessages,
    createViewerChatMessage: mocks.createViewerChatMessage,
  };
});

import { LIVE_VIEWER_SESSION_COOKIE } from "@/lib/live-quota-admission";
import { createFormSubmissionChatSessionToken, FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
import { createLiveViewerPass, LIVE_VIEWER_PASS_COOKIE } from "@/lib/live-viewer-pass";
import { LiveChatError } from "@/lib/live-chat";
import { GET, POST } from "@/app/api/live-chat/messages/route";

const admissionToken = "A".repeat(43);
const chatToken = "fss1.submission-1.1784332800." + "a".repeat(43);
const ingressSecret = "route-test-live-chat-ingress-secret-value-longer-than-32";

function headers(cookie = `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${chatToken}; ${LIVE_VIEWER_SESSION_COOKIE}=${admissionToken}`) {
  return {
    origin: "https://app.example.test",
    "x-celebratedeal-client": "web",
    "content-type": "application/json",
    cookie,
  };
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://app.example.test${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CSRF_SECRET", "route-test-secret-longer-than-thirty-two-bytes");
  vi.stubEnv("RATE_LIMIT_PROVIDER", "cloudflare_waf");
  vi.stubEnv("LIVE_CHAT_INGRESS_SECRET", ingressSecret);
  mocks.getDb.mockReturnValue({});
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.getRequestClientIp.mockReturnValue("203.0.113.5");
  mocks.listViewerChatMessages.mockResolvedValue({ messages: [], nextCursor: null, viewer: { canPost: false, displayName: null, reason: "verification_required" } });
  mocks.createViewerChatMessage.mockResolvedValue({
    created: true,
    message: { id: "message-1", source: "viewer", createdAt: "2026-08-17T00:00:00.000Z", body: "hello", actor: { name: "王小明" } },
  });
});

describe("live chat route", () => {
  it("requires the trusted same-origin client header and never caches errors", async () => {
    const response = await GET(new Request("https://app.example.test/api/live-chat/messages?vendorId=v1&liveId=l1", {
      headers: { origin: "https://app.example.test" },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listViewerChatMessages).not.toHaveBeenCalled();
  });

  it("returns 429 from the rate-limit gate before touching chat", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }));
    const response = await GET(request("/api/live-chat/messages?vendorId=v1&liveId=l1"));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listViewerChatMessages).not.toHaveBeenCalled();
  });

  it("rejects duplicate and unknown GET query keys before reaching the database", async () => {
    for (const query of [
      "vendorId=v1&vendorId=v2&liveId=l1",
      "vendorId=v1&liveId=l1&unexpected=value",
    ]) {
      const response = await GET(request(`/api/live-chat/messages?${query}`));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.listViewerChatMessages).not.toHaveBeenCalled();
  });

  it("allows an admitted viewer to read without fss1 and forwards a posting token only when present", async () => {
    const response = await GET(request(
      "/api/live-chat/messages?vendorId=v1&liveId=l1",
      { headers: { cookie: `${LIVE_VIEWER_SESSION_COOKIE}=${admissionToken}` } },
    ));
    expect(response.status).toBe(200);
    expect(mocks.listViewerChatMessages).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "v1",
      liveId: "l1",
      chatSessionToken: null,
      admissionToken,
      ipAddress: "203.0.113.5",
    }));

    const withSession = await GET(request("/api/live-chat/messages?vendorId=v1&liveId=l1"));
    expect(withSession.status).toBe(200);
    expect(mocks.listViewerChatMessages).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      chatSessionToken: chatToken,
    }));
    expect(mocks.getRequestClientIp).toHaveBeenCalledWith(expect.any(Request), {
      trustMode: "cloudflare",
      deploymentSource: "cloudflare",
      ingressSecret,
    });
  });

  it("rejects malformed POST data without a database call", async () => {
    const response = await POST(request("/api/live-chat/messages", {
      method: "POST",
      body: JSON.stringify({ vendorId: "v1", liveId: "l1", clientMessageId: "not-a-uuid", body: "hello" }),
    }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.createViewerChatMessage).not.toHaveBeenCalled();
  });

  it("rejects a POST without the trusted client header", async () => {
    const response = await POST(new Request("https://app.example.test/api/live-chat/messages", {
      method: "POST",
      headers: { origin: "https://app.example.test", "content-type": "application/json" },
      body: JSON.stringify({ vendorId: "v1", liveId: "l1", clientMessageId: "123e4567-e89b-12d3-a456-426614174000", body: "hello" }),
    }));
    expect(response.status).toBe(403);
    expect(mocks.createViewerChatMessage).not.toHaveBeenCalled();
  });

  it("fails closed before the limiter when POST has no trusted client identity", async () => {
    mocks.getRequestClientIp.mockReturnValue(null);
    const response = await POST(request("/api/live-chat/messages", {
      method: "POST",
      body: JSON.stringify({ vendorId: "v1", liveId: "l1", clientMessageId: "123e4567-e89b-12d3-a456-426614174000", body: "hello" }),
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createViewerChatMessage).not.toHaveBeenCalled();
  });

  it("does not let forged Cloudflare or forwarded headers split the limiter bucket", async () => {
    const rateLimitIdentities: string[] = [];
    mocks.checkRateLimit.mockImplementation(async (_request: Request, _key: string, _limit: number, _windowMs: number, options?: { clientIp?: string | null }) => {
      // The route always hands the limiter its resolved identity, so the
      // limiter never falls back to reading request headers itself.
      expect(options && "clientIp" in options).toBe(true);
      rateLimitIdentities.push(options?.clientIp ?? "missing");
      return null;
    });

    for (const headersForAttack of [
      { "cf-ray": "8f2b2c3d4e5f6a7b-TPE", "cf-connecting-ip": "198.51.100.40", "x-forwarded-for": "198.51.100.40" },
      { "cf-ray": "1111111111111111-TPE", "cf-connecting-ip": "198.51.100.41", "x-forwarded-for": "198.51.100.41" },
    ]) {
      const response = await POST(request("/api/live-chat/messages", {
        method: "POST",
        headers: headersForAttack,
        body: JSON.stringify({ vendorId: "v1", liveId: "l1", clientMessageId: crypto.randomUUID(), body: "hello" }),
      }));
      expect(response.status).toBe(201);
    }

    // Per request: the per-IP cap, then the speaker bucket (the fixture's chat
    // token is unsigned, so it falls back to the same trusted IP).
    expect(rateLimitIdentities).toEqual(["203.0.113.5", "203.0.113.5", "203.0.113.5", "203.0.113.5"]);
  });

  it("maps creation status, forwards fss1, and keeps the response free of contact data", async () => {
    const response = await POST(request("/api/live-chat/messages", {
      method: "POST",
      body: JSON.stringify({
        vendorId: "v1",
        liveId: "l1",
        clientMessageId: "123e4567-e89b-12d3-a456-426614174000",
        body: "hello",
      }),
    }));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toEqual({ id: "message-1", source: "viewer", createdAt: "2026-08-17T00:00:00.000Z", body: "hello", actor: { name: "王小明" } });
    expect(JSON.stringify(payload)).not.toContain("attacker@example.test");
    expect(mocks.createViewerChatMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "v1",
      liveId: "l1",
      body: "hello",
      chatSessionToken: chatToken,
      admissionToken,
      ipAddress: "203.0.113.5",
    }));
    expect(mocks.getRequestClientIp).toHaveBeenLastCalledWith(expect.any(Request), {
      trustMode: "cloudflare",
      deploymentSource: "cloudflare",
      ingressSecret,
    });
    const calls = mocks.checkRateLimit.mock.calls.map(([, key, limit, , options]) => [key, limit, options]);
    expect(calls).toEqual([
      ["live-chat-write-ip", 600, { clientIp: "203.0.113.5" }],
      ["live-chat-write", 60, { clientIp: "203.0.113.5" }],
    ]);
  });

  it("maps blocked, keyword, idempotency, transaction and server errors without leaking details", async () => {
    for (const [code, status, text] of [
      ["blocked", 403, "Unable to use live chat"],
      ["keyword_blocked", 422, "Message contains blocked text"],
      ["idempotency_conflict", 409, "Message retry conflicts with an existing message"],
      ["transaction_conflict", 409, "Message retry conflicts with an existing message"],
    ] as const) {
      mocks.createViewerChatMessage.mockRejectedValueOnce(new LiveChatError(code));
      const response = await POST(request("/api/live-chat/messages", { method: "POST", body: JSON.stringify({ vendorId: "v1", liveId: "l1", clientMessageId: "123e4567-e89b-12d3-a456-426614174000", body: "hello" }) }));
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: text });
    }
    mocks.createViewerChatMessage.mockRejectedValueOnce(new Error("private-db-detail"));
    const response = await POST(request("/api/live-chat/messages", { method: "POST", body: JSON.stringify({ vendorId: "v1", liveId: "l1", clientMessageId: "123e4567-e89b-12d3-a456-426614174000", body: "hello" }) }));
    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toEqual({ error: "Unable to use live chat" });
    expect(JSON.stringify(payload)).not.toContain("private-db-detail");
  });
});

describe("live chat limiter buckets (A4-03 MAJOR-A / MINOR-C)", () => {
  type LimiterCall = [Request, string, number, number, { clientIp: string | null }];
  const calls = () => (mocks.checkRateLimit.mock.calls as LimiterCall[]).map(([, key, limit, , options]) => ({ key, limit, clientIp: options.clientIp }));

  function pass(viewerSessionId: string, scope = { vendorId: "v1", liveId: "l1" }, token = admissionToken) {
    return createLiveViewerPass({ ...scope, viewerSessionId, admissionToken: token, sessionExpiresAt: new Date(Date.now() + 90_000) });
  }
  function readRequest(cookie: string) {
    return new Request("https://app.example.test/api/live-chat/messages?vendorId=v1&liveId=l1", { headers: headers(cookie) });
  }
  function postRequest(cookie: string) {
    return new Request("https://app.example.test/api/live-chat/messages", {
      method: "POST",
      headers: headers(cookie),
      body: JSON.stringify({ vendorId: "v1", liveId: "l1", clientMessageId: crypto.randomUUID(), body: "hello" }),
    });
  }
  const admissionCookie = `${LIVE_VIEWER_SESSION_COOKIE}=${admissionToken}`;
  const passCookie = (value: string) => `${LIVE_VIEWER_PASS_COOKIE}=${encodeURIComponent(value)}`;
  const speakerCookie = (submissionId: string) =>
    `${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${createFormSubmissionChatSessionToken({ submissionId })}`;

  it("GET: caps the source IP loosely, then buckets each viewer by its verified pass", async () => {
    await GET(readRequest(`${admissionCookie}; ${passCookie(pass("session-1"))}`));
    await GET(readRequest(`${admissionCookie}; ${passCookie(pass("session-2"))}`));
    const [ipA, viewerA, ipB, viewerB] = calls();
    expect(ipA).toEqual({ key: "live-chat-read-ip", limit: 1800, clientIp: "203.0.113.5" });
    expect(ipB).toEqual(ipA);
    expect(viewerA!.key).toBe("live-chat-read");
    expect(viewerA!.limit).toBe(60);
    expect(viewerA!.clientIp).toMatch(/^viewer-session:[0-9a-f]{32}$/u);
    expect(viewerB!.clientIp).toMatch(/^viewer-session:[0-9a-f]{32}$/u);
    expect(viewerA!.clientIp).not.toBe(viewerB!.clientIp);
  });

  it("GET: falls back to the IP for a missing, forged, foreign-scope or foreign-cookie pass", async () => {
    const valid = pass("session-1");
    const candidates = [
      null,
      valid.slice(0, -4) + "AAAA",
      pass("session-1", { vendorId: "v1", liveId: "other-live" }),
      pass("session-1", undefined, "B".repeat(43)),
    ];
    for (const candidate of candidates) {
      mocks.checkRateLimit.mockClear();
      await GET(readRequest(candidate ? `${admissionCookie}; ${passCookie(candidate)}` : admissionCookie));
      expect(calls()).toEqual([
        { key: "live-chat-read-ip", limit: 1800, clientIp: "203.0.113.5" },
        { key: "live-chat-read", limit: 60, clientIp: "203.0.113.5" },
      ]);
    }
  });

  it("POST: buckets each speaker by the verified chat session, with a per-IP cap of 600", async () => {
    expect((await POST(postRequest(`${speakerCookie("submission-a")}; ${admissionCookie}`))).status).toBe(201);
    expect((await POST(postRequest(`${speakerCookie("submission-b")}; ${admissionCookie}`))).status).toBe(201);
    const [ipA, speakerA, ipB, speakerB] = calls();
    expect(ipA).toEqual({ key: "live-chat-write-ip", limit: 600, clientIp: "203.0.113.5" });
    expect(ipB).toEqual(ipA);
    expect(speakerA!.key).toBe("live-chat-write");
    expect(speakerA!.limit).toBe(60);
    expect(speakerA!.clientIp).toMatch(/^chat-speaker:[0-9a-f]{32}$/u);
    expect(speakerA!.clientIp).not.toContain("submission-a");
    expect(speakerB!.clientIp).toMatch(/^chat-speaker:[0-9a-f]{32}$/u);
    expect(speakerB!.clientIp).not.toBe(speakerA!.clientIp);
  });

  it("POST: an unsigned chat session falls back to the IP, and a viewer pass is not a speaker identity", async () => {
    await POST(postRequest(`${FORM_SUBMISSION_CHAT_SESSION_COOKIE}=${chatToken}; ${admissionCookie}; ${passCookie(pass("session-1"))}`));
    expect(calls()).toEqual([
      { key: "live-chat-write-ip", limit: 600, clientIp: "203.0.113.5" },
      { key: "live-chat-write", limit: 60, clientIp: "203.0.113.5" },
    ]);
  });

  it("enforces both buckets: a per-IP 429 stops before the identity bucket, an identity 429 stops before chat", async () => {
    mocks.checkRateLimit.mockImplementation(async (_request: Request, key: string) =>
      key.endsWith("-ip") ? new Response(null, { status: 429 }) : null);
    const read = await GET(readRequest(`${admissionCookie}; ${passCookie(pass("session-1"))}`));
    expect(read.status).toBe(429);
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect((await POST(postRequest(`${speakerCookie("submission-a")}; ${admissionCookie}`))).status).toBe(429);
    expect(calls().map((call) => call.key)).toEqual(["live-chat-read-ip", "live-chat-write-ip"]);
    expect(mocks.listViewerChatMessages).not.toHaveBeenCalled();
    expect(mocks.createViewerChatMessage).not.toHaveBeenCalled();

    mocks.checkRateLimit.mockReset();
    mocks.checkRateLimit.mockImplementation(async (_request: Request, key: string) =>
      key.endsWith("-ip") ? null : new Response(null, { status: 429 }));
    expect((await POST(postRequest(`${speakerCookie("submission-a")}; ${admissionCookie}`))).status).toBe(429);
    expect((await GET(readRequest(`${admissionCookie}; ${passCookie(pass("session-1"))}`))).status).toBe(429);
    expect(mocks.createViewerChatMessage).not.toHaveBeenCalled();
    expect(mocks.listViewerChatMessages).not.toHaveBeenCalled();
  });
});
