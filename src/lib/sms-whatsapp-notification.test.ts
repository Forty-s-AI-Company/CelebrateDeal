import { describe, expect, it, vi } from "vitest";
import {
  createMockNotificationAdapter,
  createMockNotificationMessages,
  hashPhoneNumber,
  maskPhoneNumber,
  normalizePhoneNumber,
  sendOmnichannelNotification,
} from "@/lib/sms-whatsapp-notification";

describe("SMS / WhatsApp notification engine", () => {
  it("normalises Taiwan mobile and validates international E.164 numbers", () => {
    expect(normalizePhoneNumber("0912-345-678")).toBe("+886912345678");
    expect(normalizePhoneNumber("+14155552671")).toBe("+14155552671");
    expect(() => normalizePhoneNumber("12345")).toThrow("invalid_phone_number");
    expect(() => normalizePhoneNumber("+012345678")).toThrow("invalid_phone_number");
  });

  it("sends SMS through a deterministic mock without exposing the phone number", async () => {
    const messages = createMockNotificationMessages();
    const result = await sendOmnichannelNotification({ channel: "sms", event: "live_started", to: "0912345678", body: "直播已開始" }, { adapter: createMockNotificationAdapter(messages) });
    expect(result).toMatchObject({ status: "sent", attempts: 1, providerMessageId: expect.stringMatching(/^mock_/u) });
    expect(messages[0]?.to).toBe(maskPhoneNumber("+886912345678"));
    expect(JSON.stringify(messages)).not.toContain("0912345678");
  });

  it("sends a WhatsApp Business template for consultation reminders", async () => {
    const adapter = vi.fn(async () => ({ providerMessageId: "wamid.test" }));
    const result = await sendOmnichannelNotification({
      channel: "whatsapp", event: "consultation_reminder", to: "+819012345678", template: {
        name: "consultation_reminder", language: "ja_JP", components: [{ type: "body", parameters: [{ type: "text", text: "顧問" }] }],
      },
    }, { adapter });
    expect(result.status).toBe("sent");
    expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ channel: "whatsapp", template: expect.objectContaining({ name: "consultation_reminder" }) }));
  });

  it("honours a bounded retry budget and supports payment success", async () => {
    const adapter = vi.fn().mockRejectedValue(new Error("temporary"));
    const result = await sendOmnichannelNotification({ channel: "sms", event: "payment_success", to: "+886912345678", body: "付款成功" }, { adapter, maxAttempts: 99 });
    expect(result).toMatchObject({ status: "failed", attempts: 5, error: "temporary" });
    expect(adapter).toHaveBeenCalledTimes(5);
  });

  it("rejects malformed channel payloads before calling an adapter", async () => {
    const adapter = vi.fn(async () => ({ providerMessageId: "never" }));
    const result = await sendOmnichannelNotification({ channel: "whatsapp", event: "live_started", to: "+886912345678" }, { adapter });
    expect(result).toMatchObject({ status: "invalid", error: "whatsapp_template_required" });
    expect(adapter).not.toHaveBeenCalled();
    expect(hashPhoneNumber("0912345678")).toMatch(/^[a-f0-9]{64}$/u);
  });
});
