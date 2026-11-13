/**
 * `EmailDelivery.trigger` of the e-mails an automation rule queues. Shared by
 * the automation engine (which writes it) and the send-time checks in
 * email-delivery.ts (which read it). Kept dependency-free: the engine already
 * reaches email-delivery.ts through the immediate-dispatch hook, so neither
 * module can import the other for a constant.
 */
export const AUTOMATION_EMAIL_TRIGGER = "automation";
