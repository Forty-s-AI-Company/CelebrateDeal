import { assertTrackingDeliveryBinding, type TrackingDeliveryMode } from "@/lib/tracking-executor-binding";
import { decideTrackingDelivery, type TrackingDeliveryDecision } from "@/lib/tracking-delivery-policy";

export type MetaEvent = {
  event_name: "Purchase" | "Lead" | "ViewContent" | "Schedule";
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: { em?: string[]; ph?: string[]; external_id: string[]; client_user_agent: string };
  custom_data?: { currency: string; value: number };
};

/** 網路呼叫前驗證來源、識別雜湊及事件邊界。 */
function validateMetaEvent(event: MetaEvent): void {
  const source = new URL(event.event_source_url);
  if (!["http:", "https:"].includes(source.protocol) || source.username || source.password || source.search || source.hash ||
      event.event_source_url.length > 1024 || !event.user_data.client_user_agent || event.user_data.client_user_agent.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(event.user_data.client_user_agent) ||
      !Number.isSafeInteger(event.event_time) || event.event_time <= 0 ||
      !["Purchase", "Lead", "ViewContent", "Schedule"].includes(event.event_name) ||
      !/^[A-Za-z0-9:_-]{1,191}$/u.test(event.event_id) ||
      ![event.user_data.external_id, event.user_data.em ?? [], event.user_data.ph ?? []].every(values => values.length <= 1 && values.every(value => /^[a-f0-9]{64}$/u.test(value))) ||
      event.user_data.external_id.length !== 1) throw new TypeError("Invalid tracking event.");
}

/** 完整但無效的回應拒絕；串流中斷則以同 event ID 有界重試。 */
async function readMetaAcceptance(response: Response): Promise<{ acceptedEvents: number | null; interrupted: boolean }> {
  const invalid = { acceptedEvents: null, interrupted: false };
  const reader = response.body?.getReader();
  if (!reader) return invalid;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 65_536) { await reader.cancel(); return invalid; }
      chunks.push(chunk.value);
    }
  } catch { return { acceptedEvents: null, interrupted: true }; }
  finally { reader.releaseLock(); }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { acceptedEvents: body && typeof body === "object" && "events_received" in body && typeof body.events_received === "number" ? body.events_received : null, interrupted: false };
  } catch { return invalid; }
}

/** Server worker only: credentials and hashed identities must never enter browser props. */
export async function sendMetaTrackingEvent(input: {
  pixelId: string;
  apiVersion: string;
  token: string;
  testEventCode: string | null;
  deliveryMode?: TrackingDeliveryMode;
  event: MetaEvent;
  attempt: number;
  now: Date;
}): Promise<TrackingDeliveryDecision> {
  // Explicit mode binding keeps Preview test events out of live transmission.
  // No user-supplied endpoint or redirect is followed.
  const deliveryMode = input.deliveryMode ?? "test";
  assertTrackingDeliveryBinding(deliveryMode, input.testEventCode);
  if (!/^\d{5,32}$/u.test(input.pixelId) || !/^v\d{1,3}\.0$/u.test(input.apiVersion) ||
      !/^[A-Za-z0-9._~+/-]{16,4096}=*$/u.test(input.token)) throw new TypeError("Invalid tracking transport binding.");
  // Validate the persisted attempt before any provider network operation.
  decideTrackingDelivery({ attempt: input.attempt, now: input.now, status: null, acceptedEvents: null });
  validateMetaEvent(input.event);
  const response = await fetch(`https://graph.facebook.com/${input.apiVersion}/${input.pixelId}/events`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({ data: [input.event], ...(deliveryMode === "test" ? { test_event_code: input.testEventCode } : {}) }),
  }).catch(() => null);
  if (!response) return decideTrackingDelivery({ attempt: input.attempt, now: input.now, status: null, acceptedEvents: null });
  const result = await readMetaAcceptance(response);
  return decideTrackingDelivery({ attempt: input.attempt, now: input.now, status: result.interrupted ? null : response.status, acceptedEvents: result.acceptedEvents });
}
