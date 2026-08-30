import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSmokeTestEmail,
  isAllowedSmokeTestRecipient,
  sendTransactionalEmail,
} from "./email";

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-fixture-resend-key");
  vi.stubEnv("EMAIL_FROM", "CelebrateDeal Test <no-reply@example.test>");
  vi.stubEnv("SMOKE_TEST_EMAIL", " Smoke.Recipient@Example.Test ");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("smoke-test recipient allowlist", () => {
  it("normalizes the configured recipient but rejects every other address", () => {
    expect(getSmokeTestEmail()).toBe("smoke.recipient@example.test");
    expect(isAllowedSmokeTestRecipient("SMOKE.RECIPIENT@example.test")).toBe(true);
    expect(isAllowedSmokeTestRecipient("other@example.test")).toBe(false);
  });

  it("fails closed when no smoke-test recipient is configured", () => {
    vi.stubEnv("SMOKE_TEST_EMAIL", "");
    expect(getSmokeTestEmail()).toBeNull();
    expect(isAllowedSmokeTestRecipient("smoke.recipient@example.test")).toBe(false);
  });
});

describe("sendTransactionalEmail", () => {
  it("uses a bounded request and only returns the provider message ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "email-1",
      unexpectedProviderField: "must-not-be-returned",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "Test",
      text: "Safe body",
      idempotencyKey: "registration-confirmed/delivery-1",
    })).resolves.toEqual({ id: "email-1" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Idempotency-Key": "registration-confirmed/delivery-1",
      }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("does not include a rejected provider response in the thrown error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "recipient-and-provider-secret" }),
      { status: 422 },
    )));

    const promise = sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "Test",
      text: "Safe body",
    });

    await expect(promise).rejects.toMatchObject({
      code: "provider_rejected",
      providerStatus: 422,
    });
    await expect(promise).rejects.not.toThrow("recipient-and-provider-secret");
  });

  it("maps network failures to a closed diagnostic category", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network detail with secret")));

    await expect(sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "Test",
      text: "Safe body",
    })).rejects.toMatchObject({
      code: "network",
      providerStatus: null,
    });
  });

  it("rejects an invalid provider idempotency key before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "Test",
      text: "Safe body",
      idempotencyKey: "x".repeat(257),
    })).rejects.toMatchObject({ code: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("changes only the platform mailbox display name and sends a normalized reply_to", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-brand-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "品牌通知",
      text: "內容",
      brand: {
        version: 1,
        senderName: "品牌 \"A\" \\ 團隊",
        replyTo: "SUPPORT@EXAMPLE.TEST",
      },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.from).toBe('"品牌 \\"A\\" \\\\ 團隊" <no-reply@example.test>');
    expect(body.from).not.toContain("support@example.test");
    expect(body.reply_to).toBe("support@example.test");
    expect(body).not.toHaveProperty("replyTo");
  });

  it("appends one safe contact footer to text and html without creating a link", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-brand-2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "品牌通知",
      text: "純文字內容",
      html: "<p>HTML 內容</p>",
      brand: { version: 1, contactUrl: "https://example.test/contact?a=1&b=2" },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, string>;
    expect(body.text).toBe("純文字內容\n\n聯絡主辦單位：https://example.test/contact?a=1&b=2");
    expect(body.html).toContain("<p>聯絡主辦單位：https://example.test/contact?a=1&amp;b=2</p>");
    expect(body.html).not.toContain("<a");
    expect(body.html.match(/聯絡主辦單位/gu)).toHaveLength(1);
  });

  it("fails soft for invalid merchant brand fields and preserves the legacy payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-legacy-1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "Legacy",
      text: "原始內容",
      brand: {
        version: 1,
        senderName: "攻擊\n名稱",
        replyTo: "first@example.test,second@example.test",
        contactUrl: "https://127.0.0.1/internal",
      },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      from: "CelebrateDeal Test <no-reply@example.test>",
      text: "原始內容",
    }));
    expect(body).not.toHaveProperty("reply_to");
  });

  it("rejects an invalid platform EMAIL_FROM before making a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EMAIL_FROM", "attacker@example.test,other@example.test");

    await expect(sendTransactionalEmail({
      to: "recipient@example.test",
      subject: "Test",
      text: "Safe body",
    })).rejects.toMatchObject({ code: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
