import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ lineOfficialAccount: { findUnique: mocks.findUnique } }) }));

import { POST } from "@/app/api/webhooks/line/[vendorId]/route";

describe("LINE webhook signature contract", () => {
  const body = '{"events":[]}';
  const secret = "messaging-secret-1234567890";

  beforeEach(() => {
    vi.stubEnv("CSRF_SECRET", "line-webhook-test-secret-that-is-at-least-32-bytes");
    mocks.findUnique.mockResolvedValue({
      id: "account-1",
      vendorId: "vendor-1",
      status: "active",
      ...protectLineOfficialAccountCredentials("vendor-1", {
        messagingChannelId: "2000123456",
        messagingChannelSecret: secret,
        messagingAccessToken: "access-token-with-at-least-thirty-two-characters",
        loginChannelId: null,
        loginChannelSecret: null,
      }),
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only the exact HMAC-SHA256 signature over the raw body", async () => {
    const signature = createHmac("sha256", secret).update(body).digest("base64");
    const response = await POST(new Request("https://example.test/api/webhooks/line/vendor-1", {
      method: "POST",
      headers: { "x-line-signature": signature, "content-type": "application/json" },
      body,
    }), { params: Promise.resolve({ vendorId: "vendor-1" }) });
    expect(response.status).toBe(200);

    const rejected = await POST(new Request("https://example.test/api/webhooks/line/vendor-1", {
      method: "POST",
      headers: { "x-line-signature": signature },
      body: `${body} `,
    }), { params: Promise.resolve({ vendorId: "vendor-1" }) });
    expect(rejected.status).toBe(401);
  });

  it("rejects oversized bodies before reading provider credentials", async () => {
    mocks.findUnique.mockClear();
    const response = await POST(new Request("https://example.test/api/webhooks/line/vendor-1", {
      method: "POST",
      headers: { "content-length": "1000001" },
      body: "{}",
    }), { params: Promise.resolve({ vendorId: "vendor-1" }) });
    expect(response.status).toBe(413);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
