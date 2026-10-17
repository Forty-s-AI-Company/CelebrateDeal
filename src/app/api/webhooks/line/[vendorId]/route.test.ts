import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { protectLineOfficialAccountCredentials } from "@/lib/line-credentials";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ lineOfficialAccount: { findFirst: mocks.findUnique }, lineUserIdentity: { updateMany: mocks.updateMany } }) }));

import { POST } from "@/app/api/webhooks/line/[vendorId]/route";
import { POST as AccountPOST } from "@/app/api/webhooks/line/[vendorId]/[accountId]/route";

describe("LINE webhook signature contract", () => {
  const body = '{"events":[]}';
  const secret = "messaging-secret-1234567890";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
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
  it("routes a non-default account unfollow only through that account's signature and identity scope",async()=>{
    const secondSecret="synthetic-second-account-secret";
    const second={id:"second",vendorId:"vendor-1",status:"active",...protectLineOfficialAccountCredentials("vendor-1",{messagingChannelId:"second-channel",messagingChannelSecret:secondSecret,messagingAccessToken:"synthetic-second-access-value-without-real-access",loginChannelId:null,loginChannelSecret:null})};
    mocks.findUnique.mockImplementation(async({where})=>where.id==="second"&&where.vendorId==="vendor-1"?second:null);
    const raw=JSON.stringify({events:[{type:"unfollow",timestamp:Date.now()-1000,source:{type:"user",userId:`U${"f".repeat(32)}`}}]});
    const request=(key:string)=>new Request("https://example.test/api/webhooks/line/vendor-1/second",{method:"POST",headers:{"x-line-signature":createHmac("sha256",key).update(raw).digest("base64")},body:raw});
    expect((await AccountPOST(request(secondSecret),{params:Promise.resolve({vendorId:"vendor-1",accountId:"second"})})).status).toBe(200);
    expect(mocks.findUnique).toHaveBeenCalledWith({where:{vendorId:"vendor-1",id:"second"}});
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({where:expect.objectContaining({vendorId:"vendor-1",lineOfficialAccountId:"second"})}));
    mocks.updateMany.mockClear();
    expect((await AccountPOST(request(secret),{params:Promise.resolve({vendorId:"vendor-1",accountId:"second"})})).status).toBe(401);expect(mocks.updateMany).not.toHaveBeenCalled();
    expect((await AccountPOST(request(secondSecret),{params:Promise.resolve({vendorId:"vendor-1",accountId:"unknown"})})).status).toBe(404);expect(mocks.updateMany).not.toHaveBeenCalled();
  });

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

  async function signedEvent(payload: string, valid = true) {
    return POST(new Request("https://example.test/api/webhooks/line/vendor-1", {
      method: "POST",
      headers: { "x-line-signature": createHmac("sha256", secret).update(valid ? payload : "different").digest("base64") },
      body: payload,
    }), { params: Promise.resolve({ vendorId: "vendor-1" }) });
  }

  const unfollow = () => JSON.stringify({ events: [{ type: "unfollow", timestamp: Date.now()-1000, source: { type: "user", userId: `U${"b".repeat(32)}` } }] });

  it("applies signed unfollows only after signature verification", async () => {
    const payload = unfollow();
    expect((await signedEvent(payload, false)).status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect((await signedEvent(payload)).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", revokedAt: null }) }));
  });

  it("returns a fixed retryable failure when consent persistence fails", async () => {
    mocks.updateMany.mockRejectedValueOnce(new Error("synthetic persistence failure"));
    const response = await signedEvent(unfollow());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("rejects signed malformed JSON without consent writes", async () => {
    expect((await signedEvent("{")).status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("still records signed withdrawal while an existing account is paused", async () => {
    const account = await mocks.findUnique();
    mocks.findUnique.mockResolvedValueOnce({ ...account, status: "inactive" });
    expect((await signedEvent(unfollow())).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("returns retryable 503 for a signed provider clock ahead of the server", async () => {
    const raw = JSON.stringify({ events: [{ type: "unfollow", timestamp: Date.now()+5000, source: { type: "user", userId: `U${"b".repeat(32)}` } }] });
    expect((await signedEvent(raw)).status).toBe(503);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("converges when a partially applied batch is redelivered after a database failure", async () => {
    const raw = JSON.stringify({ events: [JSON.parse(unfollow()).events[0], { ...JSON.parse(unfollow()).events[0], source: { type: "user", userId: `U${"c".repeat(32)}` } }] });
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("synthetic second-write failure"));
    expect((await signedEvent(raw)).status).toBe(503);
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await signedEvent(raw)).status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledTimes(4);
  });
});
