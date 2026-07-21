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
    })).resolves.toEqual({ id: "email-1" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
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
});
