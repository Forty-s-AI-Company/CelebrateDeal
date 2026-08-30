import { describe, expect, it, vi } from "vitest";
import {
  createSuggestedLiveNotificationRules,
  expectedTemplateTrigger,
  haveValidLiveNotificationRuleTemplates,
  parseLiveNotificationRules,
  reconcileLiveNotificationRules,
} from "./live-notification-rules";

function rule(overrides: Partial<{
  id: string;
  trigger: "before_live" | "during_live" | "post_live_followup";
  messageTemplateId: string;
  offsetMinutes: number;
  sortOrder: number;
  isActive: boolean;
}> = {}) {
  return {
    id: "",
    trigger: "before_live" as const,
    messageTemplateId: "reminder-1",
    offsetMinutes: 60,
    sortOrder: 7,
    isActive: true,
    ...overrides,
  };
}

describe("live notification rule parser", () => {
  it("keeps empty rules valid and creates defaults only when explicitly requested", () => {
    expect(parseLiveNotificationRules([])).toEqual({ success: true, data: [] });
    const defaults = createSuggestedLiveNotificationRules({ liveReminder: "reminder-1", postLiveFollowup: "followup-1" });
    expect(defaults.map(({ trigger, offsetMinutes }) => [trigger, offsetMinutes])).toEqual([
      ["before_live", 1440], ["before_live", 60], ["before_live", 10],
      ["during_live", 10], ["during_live", 30], ["during_live", 60],
      ["post_live_followup", 15], ["post_live_followup", 1440], ["post_live_followup", 4320],
    ]);
  });

  it("creates suggestions only for template families that are actually available", () => {
    expect(createSuggestedLiveNotificationRules({ liveReminder: "reminder-1", postLiveFollowup: "" }))
      .toHaveLength(6);
    expect(createSuggestedLiveNotificationRules({ liveReminder: "", postLiveFollowup: "followup-1" }))
      .toMatchObject([
        { trigger: "post_live_followup", offsetMinutes: 15 },
        { trigger: "post_live_followup", offsetMinutes: 1440 },
        { trigger: "post_live_followup", offsetMinutes: 4320 },
      ]);
    expect(createSuggestedLiveNotificationRules({ liveReminder: "", postLiveFollowup: "" })).toEqual([]);
  });

  it("reindexes each trigger in stable UI order", () => {
    const result = parseLiveNotificationRules([
      rule({ id: "a", offsetMinutes: 60, sortOrder: 6 }),
      rule({ id: "b", trigger: "during_live", offsetMinutes: 30, sortOrder: 5 }),
      rule({ id: "c", offsetMinutes: 10, sortOrder: 4 }),
    ]);
    expect(result).toMatchObject({ success: true, data: [
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 0 },
      { id: "c", sortOrder: 1 },
    ] });
  });

  it.each([
    ["before zero", [rule({ offsetMinutes: 0 })], "offset"],
    ["negative during", [rule({ trigger: "during_live", offsetMinutes: -1 })], "invalid_shape"],
    ["over range", [rule({ trigger: "post_live_followup", offsetMinutes: 10_081 })], "invalid_shape"],
    ["duplicate offset", [rule(), rule({ id: "b" })], "duplicate"],
    ["duplicate id", [rule({ id: "same" }), rule({ id: "same", offsetMinutes: 30 })], "duplicate_id"],
    ["before over limit", [10, 20, 30, 40].map((offsetMinutes) => rule({ offsetMinutes })), "limit"],
    ["during over limit", [10, 20, 30, 40].map((offsetMinutes) => rule({ trigger: "during_live", offsetMinutes })), "limit"],
    ["post over limit", Array.from({ length: 9 }, (_, index) => rule({ trigger: "post_live_followup", offsetMinutes: index })), "limit"],
  ])("rejects %s", (_label, input, reason) => {
    expect(parseLiveNotificationRules(input)).toEqual({ success: false, reason });
  });

  it("enforces the trigger-specific tenant template shape", () => {
    const rules = [
      rule({ trigger: "before_live", messageTemplateId: "reminder-1" }),
      rule({ trigger: "post_live_followup", messageTemplateId: "followup-1", offsetMinutes: 15 }),
    ];
    const parsed = parseLiveNotificationRules(rules);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(expectedTemplateTrigger("during_live")).toBe("live_reminder");
    expect(expectedTemplateTrigger("post_live_followup")).toBe("post_live_followup");
    expect(haveValidLiveNotificationRuleTemplates(parsed.data, [
      { id: "reminder-1", vendorId: "vendor-1", channel: "email", trigger: "live_reminder", isActive: true },
      { id: "followup-1", vendorId: "vendor-1", channel: "email", trigger: "post_live_followup", isActive: true },
    ], "vendor-1")).toBe(true);
    expect(haveValidLiveNotificationRuleTemplates(parsed.data, [
      { id: "reminder-1", vendorId: "vendor-2", channel: "email", trigger: "live_reminder", isActive: true },
      { id: "followup-1", vendorId: "vendor-1", channel: "email", trigger: "live_reminder", isActive: true },
    ], "vendor-1")).toBe(false);
  });
});

describe("notification rule reconciliation", () => {
  it("supersedes each changed rule by its canonical prefix without touching siblings", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...rule({ id: "keep", sortOrder: 0 }), vendorId: "vendor-1", liveId: "live-1" },
      { ...rule({ id: "change-before", offsetMinutes: 30, sortOrder: 1 }), vendorId: "vendor-1", liveId: "live-1" },
      { ...rule({ id: "change-post", trigger: "post_live_followup", messageTemplateId: "followup-1", offsetMinutes: 15, sortOrder: 0 }), vendorId: "vendor-1", liveId: "live-1" },
      { ...rule({ id: "keep-post", trigger: "post_live_followup", messageTemplateId: "followup-1", offsetMinutes: 30, sortOrder: 1 }), vendorId: "vendor-1", liveId: "live-1" },
    ]);
    const tx = {
      liveNotificationRule: {
        findMany,
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: "new-during" }),
        deleteMany: vi.fn(),
      },
      emailDelivery: { updateMany: vi.fn() },
    };
    const parsed = parseLiveNotificationRules([
      rule({ id: "keep", sortOrder: 0 }),
      rule({ id: "change-before", offsetMinutes: 20, sortOrder: 1 }),
      rule({ id: "change-post", trigger: "post_live_followup", messageTemplateId: "followup-1", offsetMinutes: 16, sortOrder: 0 }),
      rule({ id: "keep-post", trigger: "post_live_followup", messageTemplateId: "followup-1", offsetMinutes: 30, sortOrder: 1 }),
      rule({ id: "", trigger: "during_live", offsetMinutes: 10, sortOrder: 0 }),
    ]);
    if (!parsed.success) throw new Error("fixture must parse");

    const result = await reconcileLiveNotificationRules(tx as never, { vendorId: "vendor-1", liveId: "live-1", rules: parsed.data });

    expect(tx.liveNotificationRule.update).toHaveBeenCalledTimes(2);
    expect(tx.liveNotificationRule.create).toHaveBeenCalledOnce();
    expect(result.materializeRuleIds).toEqual(["keep", "change-before", "new-during"]);
    expect(tx.liveNotificationRule.deleteMany).not.toHaveBeenCalled();
    expect(tx.emailDelivery.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.emailDelivery.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: {
        vendorId: "vendor-1",
        sourceLiveId: "live-1",
        trigger: "before_live",
        idempotencyKey: { startsWith: "live-notification/before-live/change-before/" },
        status: { in: ["queued", "failed"] },
      },
      data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "config_superseded" },
    }));
    expect(tx.emailDelivery.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {
        vendorId: "vendor-1",
        sourceLiveId: "live-1",
        trigger: "post_live_followup",
        idempotencyKey: { startsWith: "post-live-followup/change-post/" },
        status: { in: ["queued", "failed"] },
      },
      data: { status: "superseded", nextAttemptAt: null, claimedAt: null, lastErrorCode: "config_superseded" },
    }));
  });
});
