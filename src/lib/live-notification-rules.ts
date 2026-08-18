import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { postLiveFollowupIdempotencyPrefix } from "@/lib/post-live-followup";

export const LIVE_NOTIFICATION_RULE_TRIGGERS = [
  "before_live",
  "during_live",
  "post_live_followup",
] as const;

export type LiveNotificationRuleTrigger = typeof LIVE_NOTIFICATION_RULE_TRIGGERS[number];

export const LIVE_NOTIFICATION_RULE_LIMITS: Record<LiveNotificationRuleTrigger, number> = {
  before_live: 3,
  during_live: 3,
  post_live_followup: 8,
};

export const LIVE_NOTIFICATION_RULE_DEFAULT_OFFSETS: Record<LiveNotificationRuleTrigger, readonly number[]> = {
  before_live: [1440, 60, 10],
  during_live: [10, 30, 60],
  post_live_followup: [15, 1440, 4320],
};

const boundedReference = z.string().trim().max(128);

export const LiveNotificationRuleDraftSchema = z.object({
  id: boundedReference.default(""),
  trigger: z.enum(LIVE_NOTIFICATION_RULE_TRIGGERS),
  messageTemplateId: boundedReference,
  offsetMinutes: z.number().int().min(0).max(10_080),
  sortOrder: z.number().int().min(0).max(7).default(0),
  isActive: z.boolean().default(true),
}).strict();

export const LiveNotificationRuleDraftListSchema = z.array(LiveNotificationRuleDraftSchema).max(14).default([]);

const AuthoritativeLiveNotificationRuleSchema = LiveNotificationRuleDraftSchema.extend({
  messageTemplateId: z.string().trim().min(1).max(128),
});

export type LiveNotificationRuleDraft = z.infer<typeof LiveNotificationRuleDraftSchema>;
export type LiveNotificationRuleInput = z.infer<typeof AuthoritativeLiveNotificationRuleSchema>;

export type LiveNotificationRuleParseResult =
  | { success: true; data: LiveNotificationRuleInput[] }
  | { success: false; reason: "invalid_shape" | "limit" | "offset" | "duplicate" | "duplicate_id" };

export function expectedTemplateTrigger(trigger: LiveNotificationRuleTrigger) {
  return trigger === "post_live_followup" ? "post_live_followup" : "live_reminder";
}

export function parseLiveNotificationRules(input: unknown): LiveNotificationRuleParseResult {
  const parsed = z.array(AuthoritativeLiveNotificationRuleSchema).max(14).safeParse(input);
  if (!parsed.success) return { success: false, reason: "invalid_shape" };

  const counts = new Map<LiveNotificationRuleTrigger, number>();
  const offsets = new Set<string>();
  const ids = new Set<string>();
  const normalized: LiveNotificationRuleInput[] = [];

  for (const rule of parsed.data) {
    if (rule.trigger === "before_live" && rule.offsetMinutes < 1) {
      return { success: false, reason: "offset" };
    }
    const count = (counts.get(rule.trigger) ?? 0) + 1;
    if (count > LIVE_NOTIFICATION_RULE_LIMITS[rule.trigger]) {
      return { success: false, reason: "limit" };
    }
    counts.set(rule.trigger, count);

    const offsetKey = `${rule.trigger}:${rule.offsetMinutes}`;
    if (offsets.has(offsetKey)) return { success: false, reason: "duplicate" };
    offsets.add(offsetKey);
    if (rule.id && ids.has(rule.id)) return { success: false, reason: "duplicate_id" };
    if (rule.id) ids.add(rule.id);

    normalized.push({ ...rule, sortOrder: count - 1 });
  }

  return { success: true, data: normalized };
}

export function parseLiveNotificationRulesJson(value: string): LiveNotificationRuleParseResult {
  try {
    return parseLiveNotificationRules(JSON.parse(value || "[]"));
  } catch {
    return { success: false, reason: "invalid_shape" };
  }
}

export function createSuggestedLiveNotificationRules(templateIds: {
  liveReminder: string;
  postLiveFollowup: string;
}): LiveNotificationRuleDraft[] {
  return LIVE_NOTIFICATION_RULE_TRIGGERS.flatMap((trigger) => {
    const messageTemplateId = trigger === "post_live_followup" ? templateIds.postLiveFollowup : templateIds.liveReminder;
    if (!messageTemplateId) return [];
    return LIVE_NOTIFICATION_RULE_DEFAULT_OFFSETS[trigger].map((offsetMinutes, sortOrder) => ({
      id: "",
      trigger,
      messageTemplateId,
      offsetMinutes,
      sortOrder,
      isActive: true,
    }));
  });
}

export function haveValidLiveNotificationRuleTemplates(
  rules: LiveNotificationRuleInput[],
  templates: Array<{ id: string; vendorId: string; channel: string; trigger: string; isActive: boolean }>,
  vendorId: string,
) {
  const byId = new Map(templates.map((template) => [template.id, template]));
  return rules.every((rule) => {
    const template = byId.get(rule.messageTemplateId);
    return Boolean(
      template
      && template.vendorId === vendorId
      && template.channel === "email"
      && template.isActive
      && template.trigger === expectedTemplateTrigger(rule.trigger),
    );
  });
}

type NotificationRuleRecord = LiveNotificationRuleInput & {
  id: string;
  vendorId: string;
  liveId: string;
};

type NotificationRuleTransaction = Pick<
  Prisma.TransactionClient,
  "liveNotificationRule" | "emailDelivery"
>;

function ruleConfigurationChanged(existing: NotificationRuleRecord, next: LiveNotificationRuleInput) {
  return existing.trigger !== next.trigger
    || existing.messageTemplateId !== next.messageTemplateId
    || existing.offsetMinutes !== next.offsetMinutes
    || existing.isActive !== next.isActive;
}

async function supersedeRuleDeliveries(
  tx: NotificationRuleTransaction,
  rule: NotificationRuleRecord,
) {
  if (rule.trigger !== "post_live_followup") return false;
  await tx.emailDelivery.updateMany({
    where: {
      vendorId: rule.vendorId,
      sourceLiveId: rule.liveId,
      trigger: "post_live_followup",
      idempotencyKey: { startsWith: postLiveFollowupIdempotencyPrefix(rule.id) },
      status: { in: ["queued", "failed"] },
    },
    data: {
      status: "superseded",
      nextAttemptAt: null,
      claimedAt: null,
      lastErrorCode: "config_superseded",
    },
  });
  return true;
}

export async function reconcileLiveNotificationRules(
  tx: NotificationRuleTransaction,
  input: {
    vendorId: string;
    liveId: string;
    rules: LiveNotificationRuleInput[];
  },
) {
  const existing = await tx.liveNotificationRule.findMany({
    where: { vendorId: input.vendorId, liveId: input.liveId },
    select: {
      id: true,
      vendorId: true,
      liveId: true,
      trigger: true,
      messageTemplateId: true,
      offsetMinutes: true,
      sortOrder: true,
      isActive: true,
    },
  }) as NotificationRuleRecord[];
  const existingById = new Map(existing.map((rule) => [rule.id, rule]));
  const retainedIds = new Set(input.rules.flatMap((rule) => rule.id && existingById.has(rule.id) ? [rule.id] : []));
  const removed = existing.filter((rule) => !retainedIds.has(rule.id));
  const changed = input.rules.flatMap((rule) => {
    const current = rule.id ? existingById.get(rule.id) : undefined;
    return current && ruleConfigurationChanged(current, rule) ? [current] : [];
  });

  let superseded = 0;
  for (const rule of [...removed, ...changed]) {
    if (await supersedeRuleDeliveries(tx, rule)) superseded += 1;
  }
  if (removed.length > 0) {
    await tx.liveNotificationRule.deleteMany({
      where: { vendorId: input.vendorId, liveId: input.liveId, id: { in: removed.map((rule) => rule.id) } },
    });
  }

  for (const rule of input.rules) {
    const current = rule.id ? existingById.get(rule.id) : undefined;
    const data = {
      trigger: rule.trigger,
      messageTemplateId: rule.messageTemplateId,
      offsetMinutes: rule.offsetMinutes,
      sortOrder: rule.sortOrder,
      isActive: rule.isActive,
    };
    if (current) {
      if (ruleConfigurationChanged(current, rule) || current.sortOrder !== rule.sortOrder) {
        await tx.liveNotificationRule.update({
          where: { id: current.id, vendorId: input.vendorId },
          data,
        });
      }
    } else {
      await tx.liveNotificationRule.create({
        data: { ...data, vendorId: input.vendorId, liveId: input.liveId },
      });
    }
  }

  return { retained: retainedIds.size, created: input.rules.length - retainedIds.size, removed: removed.length, superseded };
}
