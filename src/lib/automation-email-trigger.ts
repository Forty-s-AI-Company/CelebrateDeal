/**
 * EmailDelivery triggers shared by the automation engine, the delayed-step
 * worker and email-delivery.ts. Dependency-free on purpose: the delayed-step
 * worker reaches email-delivery.ts through the automation engine, and
 * email-delivery.ts needs these values at module load, so they cannot live in
 * any module of that chain.
 */

/**
 * `EmailDelivery.trigger` of the e-mails an automation rule queues. Shared by
 * the automation engine (which writes it) and the send-time checks in
 * email-delivery.ts (which read it). Kept dependency-free: the engine already
 * reaches email-delivery.ts through the immediate-dispatch hook, so neither
 * module can import the other for a constant.
 */
export const AUTOMATION_EMAIL_TRIGGER = "automation";

/**
 * `EmailDelivery.trigger` of the e-mails a delayed automation step queues
 * (F-4 PR 2). Same marketing rules as AUTOMATION_EMAIL_TRIGGER, but dispatched
 * with the sequence e-mails on their own per-round quota and counted in the
 * sequence queue limit, so delayed steps cannot pass the platform-wide cap of
 * F-3 (docs/product/delayed-steps-design.md §3「吞吐量」).
 */
export const AUTOMATION_STEP_EMAIL_TRIGGER = "automation_step";

/** `EmailDelivery.trigger` of an F-3 sequence step e-mail (re-exported by delayed-step-runs.ts). */
export const SEQUENCE_EMAIL_TRIGGER = "sequence_email";

/**
 * Triggers sent on the sequence quota (processDueSequenceEmailDeliveries) and
 * counted in its queue: F-3 sequence e-mails and F-4 delayed automation step
 * e-mails. Both are created only into the same free capacity, so together
 * they never exceed one round's dispatch quota.
 */
export const DELAYED_STEP_EMAIL_TRIGGERS = [SEQUENCE_EMAIL_TRIGGER, AUTOMATION_STEP_EMAIL_TRIGGER] as const;

const AUTOMATION_STEP_EVENT_PREFIX = "delayed-step:";

/** `AutomationExecutionLog.eventId` of a delayed step's execution. */
export function automationStepEventId(runId: string, stepId: string) {
  return `${AUTOMATION_STEP_EVENT_PREFIX}${runId}:${stepId}`;
}

/** The run and step a delayed step's execution log belongs to, or null for any other log. */
export function parseAutomationStepEventId(eventId: string) {
  const match = /^delayed-step:([A-Za-z0-9_-]{1,191}):([A-Za-z0-9_-]{1,191})$/u.exec(eventId);
  return match ? { runId: match[1]!, stepId: match[2]! } : null;
}

/**
 * `EmailDelivery.idempotencyKey` of a delayed step's e-mail: it names the
 * step's execution log, so the send-time check can find the rule and the run
 * behind the e-mail (review MINOR-3). Immediate automation e-mails keep their
 * hashed key.
 */
export function automationStepEmailIdempotencyKey(executionLogId: string, actionIndex: number) {
  return `automation-step-email/${executionLogId}/${actionIndex}`;
}

export function parseAutomationStepEmailIdempotencyKey(value: string | undefined) {
  const match = /^automation-step-email\/(aes_[a-f0-9]{28})\/(\d{1,2})$/u.exec(value ?? "");
  return match ? { executionLogId: match[1]! } : null;
}
