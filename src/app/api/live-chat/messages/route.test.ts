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
import { FORM_SUBMISSION_CHAT_SESSION_COOKIE } from "@/lib/form-submission-chat-session";
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
    mocks.checkRateLimit.mockImplementation(async (limitedRequest: Request) => {
      rateLimitIdentities.push(limitedRequest.headers.get("cf-connecting-ip") ?? "missing");
      expect(limitedRequest.headers.get("x-forwarded-for")).toBeNull();
      expect(limitedRequest.headers.get("x-real-ip")).toBeNull();
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

    expect(rateLimitIdentities).toEqual(["203.0.113.5", "203.0.113.5"]);
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
    const [limiterRequest, limiterKey] = mocks.checkRateLimit.mock.calls[0] as [Request, string];
    expect(limiterRequest.headers.get("cf-connecting-ip")).toBe("203.0.113.5");
    expect(limiterRequest.headers.get("x-forwarded-for")).toBeNull();
    expect(limiterKey).toBe("live-chat-write");
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
