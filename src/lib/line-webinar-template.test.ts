import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLineWebinarMessages, findLineWebinarTemplate, lineWebinarTemplateFingerprint, LINE_BLOCK_HELP_URL } from "./line-webinar-template";
import { enqueueLineNotification, processDueLineDeliveries, stableLineIdempotencyKey } from "./line-notification";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";
import { normalizeMessageTemplateDraft } from "./message-template";

const at = new Date("2026-10-16T01:00:00Z");
const template = { id: "template-a", vendorId: "vendor-a", name: "合成LINE提醒", channel: "line", trigger: "live_reminder", subject: "{{live_title}}", body: "**{{name}}**，{{vendor_name}} {{live_start_at}} {{unsubscribe_url}}", isActive: true, updatedAt: new Date(at.getTime()-1000) };
const variables = { name: "合成報名者", live_title: "合成直播", vendor_name: "合成商家", live_start_at: "20:00", live_url: "https://example.test/live/synthetic" };

describe("merchant LINE webinar templates", () => {
  beforeEach(() => vi.stubEnv("CSRF_SECRET", "wp13-template-synthetic-key-at-least-32-bytes"));
  afterEach(() => vi.unstubAllEnvs());

  it("renders merchant copy, preserves literal recipient values, adds entry and native block instructions", () => {
    const messages = buildLineWebinarMessages(template, variables);
    expect(messages).toEqual([{ type: "text", text: expect.stringContaining("合成報名者，合成商家 20:00") }]);
    expect(JSON.stringify(messages)).toContain(variables.live_url);
    expect(JSON.stringify(messages)).toContain(LINE_BLOCK_HELP_URL);
    expect(JSON.stringify(messages)).toContain("停止接收：請在 LINE 封鎖本官方帳號");
    expect(JSON.stringify(messages)).not.toContain("{{");
  });

  it.each([{ isActive: false }, { channel: "email" }, { trigger: "post_live_followup" }, { subject: null }, { body: "{{unknown}}" }])("rejects unusable or unsupported LINE content", changes => {
    expect(buildLineWebinarMessages({ ...template, ...changes }, variables)).toBeNull();
  });

  it("splits long rendered copy without truncation or broken surrogate pairs", () => {
    const body = "😀".repeat(9999);
    const messages = buildLineWebinarMessages({ ...template, body }, variables)!;
    expect(messages.length).toBeLessThanOrEqual(5);
    const texts = messages.map(message => { expect(message.type).toBe("text");return (message as { text: string }).text; });
    expect(texts.join("")).toContain(body);
    expect(texts.every(text => text.length <= 5000 && !/[\uD800-\uDBFF]$/u.test(text) && !/^[\uDC00-\uDFFF]/u.test(text))).toBe(true);
    expect(buildLineWebinarMessages({ ...template, body: "{{name}}" }, { ...variables, name: "x".repeat(26_000) })).toBeNull();
  });

  it("keeps multi-codepoint emoji and links together at a text-object boundary", () => {
    const body = "x".repeat(4980)+"👨‍👩‍👧 🇹🇼 👍🏽 https://example.test/long-link";
    const messages = buildLineWebinarMessages({ ...template, subject: "Synthetic", body }, variables)!;
    const texts = messages.map(message => (message as { text: string }).text);
    expect(texts.join("")).toContain(body);
    for (const token of ["👨‍👩‍👧", "🇹🇼", "👍🏽", "https://example.test/long-link"]) expect(texts.some(text => text.includes(token))).toBe(true);
    expect(texts.every(text => text.length<=5000)).toBe(true);
  });

  it("packs six long Chinese paragraphs and protects a URL attached to Chinese copy", () => {
    const body = Array(6).fill("文".repeat(3000)).join("\n");
    const paragraphs = buildLineWebinarMessages({ ...template, body }, variables)!;
    expect(paragraphs.length).toBeLessThanOrEqual(5);
    expect(paragraphs.map(message => (message as {text:string}).text).join("")).toContain(body);
    const attached = buildLineWebinarMessages({ ...template, body: "文".repeat(5200)+"{{live_url}}" }, variables)!;
    expect(attached.some(message => (message as {text:string}).text.includes(variables.live_url))).toBe(true);
  });

  it("rejects oversized variable expansion at save time instead of silently accepting an unsendable template", () => {
    const draft = { name: template.name, channel: template.channel, trigger: template.trigger, subject: template.subject, body: "{{live_url}}".repeat(20), isActive: true };
    expect(normalizeMessageTemplateDraft(draft)).toEqual({ success: false });
  });

  it("uses only the tenant's latest saved event template, including its inactive choice", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...template, isActive: false });
    const result = await findLineWebinarTemplate({ messageTemplate: { findFirst } } as never, "vendor-a", "live_reminder");
    expect(result?.isActive).toBe(false);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-a", channel: "line", trigger: "live_reminder" }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }] }));
  });

  function queueDb(value: typeof template | null = template) {
    return {
      lineOfficialAccount: { findUnique: vi.fn().mockResolvedValue({ id: "account-a", status: "active" }) },
      lineUserIdentity: { findUnique: vi.fn().mockResolvedValue({ id: "identity-a", revokedAt: null }) },
      messageTemplate: { findFirst: vi.fn().mockResolvedValue(value) },
      lineDelivery: { create: vi.fn().mockResolvedValue({ id: "delivery-a" }) },
    };
  }
  const input = { vendorId: "vendor-a", subjectType: "buyer_registration" as const, subjectId: "registration-a", trigger: "live_reminder" as const, idempotencyKey: "synthetic-reminder", messages: [{ type: "text" as const, text: "legacy copy" }], templateVariables: variables };

  it("persists encrypted authored content with its source template", async () => {
    const db = queueDb();
    expect((await enqueueLineNotification(db as never, input)).status).toBe("queued");
    const data = db.lineDelivery.create.mock.calls[0][0].data;
    expect(data.sourceTemplateId).toBe(template.id);
    expect(JSON.stringify(data)).not.toContain(variables.name);
    const body = decryptSensitiveValue(data.payloadEncrypted, `line-delivery:vendor-a:${data.id}`);
    expect(body).toContain(variables.name);expect(body).not.toContain("legacy copy");
  });

  it("does not create new registration messages unless the merchant configures them", async () => {
    const db = queueDb(null);
    expect((await enqueueLineNotification(db as never, { ...input, trigger: "registration_confirmed", requireTemplate: true, messages: [] })).status).toBe("not_configured");
    expect(db.lineDelivery.create).not.toHaveBeenCalled();
    expect((await enqueueLineNotification(db as never, input)).status).toBe("queued");
  });

  it("stops queuing when the latest merchant choice is inactive", async () => {
    const db = queueDb({ ...template, isActive: false });
    expect((await enqueueLineNotification(db as never, input)).status).toBe("template_disabled_or_invalid");
    expect(db.lineDelivery.create).not.toHaveBeenCalled();
  });

  it.each([null, { ...template, isActive: false }, { ...template, id: "replacement" }, { ...template, updatedAt: new Date(at.getTime()+1) }, { ...template, body: "same-millisecond changed content" }])("suppresses queued old copy before any provider call", async latest => {
    const start = new Date(at.getTime()+60000);
    const current = { id: "delivery-a", vendorId: "vendor-a", trigger: "live_reminder", idempotencyKey: stableLineIdempotencyKey(["live_reminder", "live-a", "registration-a", start]), sourceTemplateId: template.id, createdAt: at, payloadEncrypted: encryptSensitiveValue(JSON.stringify({v:2,templateFingerprint:lineWebinarTemplateFingerprint(template),messages:[{type:"text",text:"old copy"}]}), "line-delivery:vendor-a:delivery-a"), status: "queued", attemptCount: 0, account: { vendorId: "vendor-a", status: "active" }, identity: { vendorId: "vendor-a", subjectType: "buyer_registration", subjectId: "registration-a", revokedAt: null } };
    const db = { lineDelivery: { findMany: vi.fn().mockResolvedValue([current]), findFirst: vi.fn().mockResolvedValue(current), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, messageTemplate: { findFirst: vi.fn().mockResolvedValue(latest) }, formSubmission: { findFirst: vi.fn().mockResolvedValue({ live: { id:"live-a", status: "scheduled", scheduledAt: start, startedAt: null, endedAt: null } }) } };
    const factory = vi.fn();
    expect(await processDueLineDeliveries(db as never, factory, at)).toEqual([{ id: current.id, status: "suppressed" }]);
    expect(factory).not.toHaveBeenCalled();
    expect(db.formSubmission.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "registration-a", verificationStatus: "VERIFIED", form: { vendorId: "vendor-a" }, live: { vendorId: "vendor-a" } } }));
  });
});
