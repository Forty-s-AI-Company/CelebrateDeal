import { describe, expect, it } from "vitest";

import { interactionEventTypeLabel, normalizeInteractionEventDraft } from "./interaction-event";

describe("normalizeInteractionEventDraft", () => {
  it("normalizes message events and removes stale product or CTA data", () => {
    expect(normalizeInteractionEventDraft({
      eventType: "chat_message",
      triggerSec: 5,
      title: "",
      message: "  官方歡迎訊息  ",
      roleId: "role-1",
      productId: "stale-product",
      ctaLabel: "stale CTA",
      ctaUrl: "https://example.test/stale",
    })).toEqual({
      success: true,
      data: {
        eventType: "chat_message",
        triggerSec: 5,
        title: "官方歡迎訊息",
        message: "官方歡迎訊息",
        roleId: "role-1",
        productId: null,
        ctaLabel: null,
        ctaUrl: null,
      },
    });
  });

  it("requires an exact product reference and removes message data", () => {
    expect(normalizeInteractionEventDraft({
      eventType: "product_spotlight",
      triggerSec: 30,
      title: "主打商品",
      message: "stale message",
      roleId: "stale-role",
      productId: "product-1",
    })).toEqual({
      success: true,
      data: {
        eventType: "product_spotlight",
        triggerSec: 30,
        title: "主打商品",
        message: null,
        roleId: null,
        productId: "product-1",
        ctaLabel: null,
        ctaUrl: null,
      },
    });
    expect(normalizeInteractionEventDraft({ eventType: "product_spotlight", triggerSec: 30, productId: null }).success).toBe(false);
  });

  it("normalizes a safe CTA and rejects unsafe navigation", () => {
    expect(normalizeInteractionEventDraft({
      eventType: "cta_switch",
      triggerSec: 45,
      ctaLabel: " 查看完整優惠 ",
      ctaUrl: "https://shop.example.test/deal",
    })).toEqual({
      success: true,
      data: expect.objectContaining({
        eventType: "cta_switch",
        title: "查看完整優惠",
        ctaLabel: "查看完整優惠",
        ctaUrl: "https://shop.example.test/deal",
      }),
    });
    expect(normalizeInteractionEventDraft({
      eventType: "cta_switch",
      triggerSec: 45,
      ctaLabel: "危險連結",
      ctaUrl: "javascript:alert(1)",
    })).toEqual({ success: false, error: "第 1 個事件的 CTA 必須是安全的 HTTP 或 HTTPS 完整網址。" });
  });

  it("rejects unsupported types, empty messages, and invalid time", () => {
    expect(normalizeInteractionEventDraft({ eventType: "fake_viewer", triggerSec: 0 })).toEqual({
      success: false,
      error: "第 1 個事件的事件類型不受支援。",
    });
    expect(normalizeInteractionEventDraft({ eventType: "reminder", triggerSec: 0, message: "" }).success).toBe(false);
    expect(normalizeInteractionEventDraft({ eventType: "chat_message", triggerSec: -1, message: "hello" }).success).toBe(false);
  });

  it("requires a role for every scheduled message event", () => {
    expect(normalizeInteractionEventDraft({
      eventType: "chat_message",
      triggerSec: 10,
      message: "請選擇角色",
      roleId: "",
    })).toEqual({ success: false, error: "第 1 個事件必須選擇排程角色。" });
    expect(normalizeInteractionEventDraft({
      eventType: "reminder",
      triggerSec: 20,
      message: "請記得回來看優惠",
    })).toEqual({ success: false, error: "第 1 個事件必須選擇排程角色。" });
  });

  it("uses transparent merchant-facing event labels", () => {
    expect(interactionEventTypeLabel("chat_message")).toBe("官方留言");
    expect(interactionEventTypeLabel("product_spotlight")).toBe("商品聚焦");
    expect(interactionEventTypeLabel("cta_switch")).toBe("CTA 切換");
    expect(interactionEventTypeLabel("lucky_draw")).toBe("幸運大抽獎");
    expect(interactionEventTypeLabel("poll")).toBe("即時投票");
    expect(interactionEventTypeLabel("flash_voucher")).toBe("空投限時紅包");
    expect(interactionEventTypeLabel("fake_viewer")).toBe("未知事件");
  });

  it("normalizes lucky draw timing and slogan", () => {
    expect(normalizeInteractionEventDraft({
      eventType: "lucky_draw",
      triggerSec: 90,
      title: "週年抽獎",
      metadata: { durationSec: 20, slogan: "週年快樂" },
    })).toEqual({
      success: true,
      data: expect.objectContaining({
        eventType: "lucky_draw",
        title: "週年抽獎",
        metadata: { kind: "lucky_draw", durationSec: 20, slogan: "週年快樂" },
      }),
    });
    expect(normalizeInteractionEventDraft({
      eventType: "lucky_draw",
      triggerSec: 90,
      metadata: { slogan: "" },
    }).success).toBe(false);
  });

  it("canonicalizes poll options so clients cannot choose arbitrary identifiers", () => {
    expect(normalizeInteractionEventDraft({
      eventType: "poll",
      triggerSec: 120,
      metadata: { question: "最喜歡哪一款？", options: ["藍色", { id: "forged", label: "紅色" }] },
    })).toEqual({
      success: true,
      data: expect.objectContaining({
        eventType: "poll",
        title: "最喜歡哪一款？",
        metadata: {
          kind: "poll",
          durationSec: 60,
          question: "最喜歡哪一款？",
          options: [
            { id: "option-1", label: "藍色" },
            { id: "option-2", label: "紅色" },
          ],
        },
      }),
    });
    expect(normalizeInteractionEventDraft({
      eventType: "poll",
      triggerSec: 120,
      metadata: { question: "只有一項", options: ["唯一選項"] },
    }).success).toBe(false);
  });

  it("validates percentage and fixed flash vouchers", () => {
    expect(normalizeInteractionEventDraft({
      eventType: "flash_voucher",
      triggerSec: 180,
      title: "前 50 名九折",
      metadata: {
        durationSec: 45,
        maxClaims: 50,
        discountType: "percentage",
        discountValue: 10,
        productId: "product-1",
      },
    })).toEqual({
      success: true,
      data: expect.objectContaining({
        eventType: "flash_voucher",
        productId: "product-1",
        metadata: {
          kind: "flash_voucher",
          durationSec: 45,
          maxClaims: 50,
          discountType: "percentage",
          discountValue: 10,
          productId: "product-1",
        },
      }),
    });
    expect(normalizeInteractionEventDraft({
      eventType: "flash_voucher",
      triggerSec: 180,
      metadata: { maxClaims: 10, discountType: "percentage", discountValue: 100 },
    }).success).toBe(false);
  });
});
