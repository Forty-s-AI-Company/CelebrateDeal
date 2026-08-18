export const LIVE_NOTIFICATION_DELIVERY_TRIGGERS = ["before_live", "during_live"] as const;

export type LiveNotificationDeliveryTrigger = typeof LIVE_NOTIFICATION_DELIVERY_TRIGGERS[number];

const RULE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const IDENTITY_PATTERN = /^live-notification\/(before-live|during-live)\/([A-Za-z0-9_-]{1,128})\/email_[a-f0-9]{32}$/u;

export function liveNotificationIdempotencyPrefix(trigger: LiveNotificationDeliveryTrigger, ruleId: string) {
  if (!RULE_ID_PATTERN.test(ruleId)) throw new Error("invalid_live_notification_rule_id");
  const segment = trigger === "before_live" ? "before-live" : "during-live";
  return `live-notification/${segment}/${ruleId}/`;
}

export function liveNotificationIdentityFromKey(idempotencyKey: string) {
  const match = IDENTITY_PATTERN.exec(idempotencyKey);
  if (!match) return null;
  const segment = match[1];
  const ruleId = match[2];
  if (!segment || !ruleId) return null;
  return {
    trigger: segment === "before-live" ? "before_live" as const : "during_live" as const,
    ruleId,
  };
}
