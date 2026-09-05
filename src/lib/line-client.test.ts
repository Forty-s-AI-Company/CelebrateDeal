import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  LineFetchClient,
  MockLineMessagingClient,
  verifyLineSignature,
} from "./line-client";

describe("LineFetchClient", () => {
  it("pushes text with the LINE endpoint and bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const client = new LineFetchClient("secret-token", { fetchImpl });

    await client.pushText("U123", "直播開始囉", { retryKey: "123e4567-e89b-42d3-a456-426614174000" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret-token", "X-Line-Retry-Key": "123e4567-e89b-42d3-a456-426614174000" }),
        body: JSON.stringify({ to: "U123", messages: [{ type: "text", text: "直播開始囉" }] }),
      }),
    );
  });

  it("pushes a valid Flex message", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const contents = { type: "bubble", body: { type: "box", layout: "vertical", contents: [] } } as const;
    await new LineFetchClient("token", { fetchImpl }).pushFlex("U1", "訂單收據", contents);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      messages: [{ type: "flex", altText: "訂單收據", contents }],
    });
  });

  it("rejects invalid values and does not call fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new LineFetchClient("token", { fetchImpl });
    await expect(client.pushText("", "hello")).rejects.toThrow(/recipient/);
    await expect(client.pushText("U1", "")).rejects.toThrow(/text/);
    await expect(client.pushFlex("U1", "alt", { type: "invalid" } as never)).rejects.toThrow(/Flex/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("hides response and network details in errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("token=do-not-leak", { status: 401 }));
    await expect(new LineFetchClient("top-secret", { fetchImpl }).pushText("U1", "hello"))
      .rejects.toThrow("HTTP 401");
    await expect(new LineFetchClient("top-secret", { fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("top-secret socket")) }).pushText("U1", "hello"))
      .rejects.toThrow("request failed");
  });
});

describe("MockLineMessagingClient", () => {
  it("records calls without network access and supports controlled failures", async () => {
    const client = new MockLineMessagingClient();
    await client.pushText("U1", "hello");
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toEqual({ to: "U1", messages: [{ type: "text", text: "hello" }] });
    client.setFailure(new Error("offline"), 1);
    await expect(client.pushText("U1", "retry")).rejects.toThrow("offline");
    await client.pushText("U1", "retry");
    expect(client.calls).toHaveLength(2);
  });
});

describe("verifyLineSignature", () => {
  it("validates LINE's HMAC-SHA256 base64 signature", () => {
    const body = Buffer.from('{"events":[]}');
    const secret = "channel-secret";
    const signature = createHmac("sha256", secret).update(body).digest("base64");
    expect(verifyLineSignature(body, signature, secret)).toBe(true);
    expect(verifyLineSignature(body.toString(), signature, secret)).toBe(true);
    expect(verifyLineSignature(body, `${signature.slice(0, -2)}aa`, secret)).toBe(false);
    expect(verifyLineSignature(body, "not-base64!", secret)).toBe(false);
  });
});
