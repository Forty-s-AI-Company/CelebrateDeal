import webpush from "web-push";
import { z } from "zod";
import { sendTransactionalEmail, TransactionalEmailError } from "./email";
import { LearnerEmailDestination, LearnerPhoneDestination, LearnerPushDestination, type LearnerNotificationChannel } from "./learner-notification-contract";
import { LearnerNotificationMessage } from "./learner-notification-outbox";

export { LearnerPushDestination } from "./learner-notification-contract";
export type NotificationProviderConfiguration = {
 email?: { enabled: true };
 sms?: { accountSid: string; authToken: string; from: string };
 whatsapp?: { version: string; phoneNumberId: string; accessToken: string; templateName: string; language: string };
 push?: { subject: string; publicKey: string; privateKey: string };
};
export type NotificationProviderResult = { outcome: "sent" | "not_delivered" | "indeterminate"; providerReceipt?: string; code?: "CONFIGURATION" | "INVALID_DESTINATION" | "REJECTED" | "OUTCOME_UNKNOWN" };
const unknownResult: NotificationProviderResult = { outcome: "indeterminate", code: "OUTCOME_UNKNOWN" };
const rejectedResult: NotificationProviderResult = { outcome: "not_delivered", code: "REJECTED" };
const configurationResult: NotificationProviderResult = { outcome: "not_delivered", code: "CONFIGURATION" };

/** Read only bounded JSON. Provider bodies may contain contacts or credentials;
 * neither those bodies nor exception messages reach logs or public responses. */
async function boundedJson(response: Response): Promise<unknown> {
 if (!response.body) return null;
 const reader = response.body.getReader(), chunks: Uint8Array[] = [];
 let bytes = 0;
 try {
  for (;;) {
   const next = await reader.read(); if (next.done) break;
   bytes += next.value.byteLength; if (bytes > 8192) return null;
   chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
 } catch { return null; }
 finally { await reader.cancel().catch(() => undefined); }
}
function appMessage(raw: unknown, appOrigin: string) {
 const message = LearnerNotificationMessage.parse(raw), origin = new URL(appOrigin);
 if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid notification origin.");
 return { ...message, text: `${message.title}\n${message.body}\n${new URL(message.path,origin).toString()}` };
}

type ProviderInput = { channel: LearnerNotificationChannel; destination: unknown; message: unknown; appOrigin: string; idempotencyKey: string };
type PreparedInput = ProviderInput & { prepared: ReturnType<typeof appMessage> };
async function sendEmail(input: PreparedInput, config: NotificationProviderConfiguration): Promise<NotificationProviderResult> {
 if (!config.email) return configurationResult;
 const parsed = LearnerEmailDestination.safeParse(input.destination);
 if (!parsed.success) return { outcome: "not_delivered", code: "INVALID_DESTINATION" };
 try {
  const receipt = await sendTransactionalEmail({ to: parsed.data.email, subject: input.prepared.title, text: input.prepared.text, idempotencyKey: input.idempotencyKey });
  return { outcome: "sent", providerReceipt: receipt.id };
 } catch (error) {
  if (error instanceof TransactionalEmailError && error.code === "configuration") return configurationResult;
  if (error instanceof TransactionalEmailError && error.code === "provider_rejected" && error.providerStatus && error.providerStatus >= 400 && error.providerStatus < 500) return rejectedResult;
  return unknownResult;
 }
}
/** Consume at most 8 KiB without retaining provider response content. The fetch
 * abort signal applies to headers and body, including a continuously active stream. */
async function boundedPushResponse(response: Response) {
 if (!response.body) return true;
 const reader = response.body.getReader();
 let bytes = 0;
 try {
  for (;;) {
   const chunk = await reader.read();
   if (chunk.done) return true;
   bytes += chunk.value.byteLength;
   if (bytes > 8192) return false;
  }
 } finally { await reader.cancel().catch(() => undefined); }
}
async function sendPush(input: PreparedInput, config: NotificationProviderConfiguration): Promise<NotificationProviderResult> {
 if (!config.push) return configurationResult;
 const parsed = LearnerPushDestination.safeParse(input.destination);
 if (!parsed.success) return { outcome: "not_delivered", code: "INVALID_DESTINATION" };
 try {
  const request = webpush.generateRequestDetails(parsed.data, JSON.stringify({ title: input.prepared.title, body: input.prepared.body, path: input.prepared.path }),
   { vapidDetails: config.push, TTL: 300, contentEncoding: "aes128gcm" });
  const response = await fetch(request.endpoint, { method: "POST", redirect: "error",
   headers: Object.fromEntries(Object.entries(request.headers).map(([key,value]) => [key,String(value)])),
   body: request.body ? new Uint8Array(request.body) : null, signal: AbortSignal.timeout(10000) });
  if (!await boundedPushResponse(response)) return unknownResult;
  if (response.status >= 400 && response.status < 500) return rejectedResult;
  return response.status >= 200 && response.status < 300 ? { outcome: "sent", providerReceipt: `push_http_${response.status}` } : unknownResult;
 } catch (error) {
  const status = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : null;
  return typeof status === "number" && status >= 400 && status < 500 ? rejectedResult : unknownResult;
 }
}
type ProviderRequest = { url: string; headers: Record<string,string>; body: string };
function smsRequest(phone: string, text: string, c: NotificationProviderConfiguration["sms"]): ProviderRequest | null {
 if (!c || !/^AC[a-fA-F0-9]{32}$/u.test(c.accountSid) || !c.authToken || !LearnerPhoneDestination.safeParse({ phone: c.from }).success) return null;
 return { url: `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`,
  headers: { authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ To: phone, From: c.from, Body: text }).toString() };
}
function whatsappRequest(phone: string, text: string, c: NotificationProviderConfiguration["whatsapp"]): ProviderRequest | null {
 if (!c || !/^v[1-9][0-9]?\.[0-9]$/u.test(c.version) || !/^[0-9]{1,32}$/u.test(c.phoneNumberId) || !c.accessToken || !/^[a-z0-9_]{1,512}$/u.test(c.templateName) || !/^[a-z]{2}(?:_[A-Z]{2})?$/u.test(c.language)) return null;
 return { url: `https://graph.facebook.com/${c.version}/${c.phoneNumberId}/messages`, headers: { authorization: `Bearer ${c.accessToken}`, "content-type": "application/json" },
  body: JSON.stringify({ messaging_product: "whatsapp", to: phone.slice(1), type: "template", template: { name: c.templateName, language: { code: c.language }, components: [{ type: "body", parameters: [{ type: "text", text }] }] } }) };
}
function parseReceipt(result: unknown, channel: LearnerNotificationChannel): string | null {
 if (channel === "sms") {
  const parsed = z.object({ sid: z.string().regex(/^SM[a-fA-F0-9]{32}$/u) }).safeParse(result);
  return parsed.success ? parsed.data.sid : null;
 }
 const parsed = z.object({ messages: z.array(z.object({ id: z.string().regex(/^wamid\.[A-Za-z0-9+/=_-]{1,240}$/u) })).length(1) }).safeParse(result);
 return parsed.success ? parsed.data.messages[0]!.id : null;
}
async function sendPhone(input: PreparedInput, config: NotificationProviderConfiguration): Promise<NotificationProviderResult> {
 const phone = LearnerPhoneDestination.safeParse(input.destination);
 if (!phone.success) return { outcome: "not_delivered", code: "INVALID_DESTINATION" };
 const request = input.channel === "sms" ? smsRequest(phone.data.phone,input.prepared.text,config.sms) : whatsappRequest(phone.data.phone,input.prepared.text,config.whatsapp);
 if (!request) return configurationResult;
 try {
  const response = await fetch(request.url,{ method: "POST", headers: request.headers, body: request.body, redirect: "error", signal: AbortSignal.timeout(10000) });
  if (response.status >= 400 && response.status < 500) return rejectedResult;
  if (!response.ok) return unknownResult;
  const receipt = parseReceipt(await boundedJson(response),input.channel);
  return receipt ? { outcome: "sent", providerReceipt: receipt } : unknownResult;
 } catch { return unknownResult; }
}

/** Configured providers only. "sent" records provider acceptance, never a claim
 * that the recipient read it. Network/5xx ambiguity cannot trigger a blind retry. */
export async function sendLearnerNotificationProvider(input: ProviderInput, config: NotificationProviderConfiguration): Promise<NotificationProviderResult> {
 if (!/^[a-f0-9]{64}$/u.test(input.idempotencyKey)) return configurationResult;
 let prepared: ReturnType<typeof appMessage>;
 try { prepared = appMessage(input.message,input.appOrigin); } catch { return configurationResult; }
 const resolved = { ...input, prepared };
 if (input.channel === "email") return sendEmail(resolved,config);
 if (input.channel === "push") return sendPush(resolved,config);
 if (input.channel === "sms" || input.channel === "whatsapp") return sendPhone(resolved,config);
 return configurationResult;
}
