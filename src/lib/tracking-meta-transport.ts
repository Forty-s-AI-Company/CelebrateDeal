import { decideTrackingDelivery, type TrackingDeliveryDecision } from "@/lib/tracking-delivery-policy";

type MetaEvent = {
  event_name: "Purchase" | "Lead" | "ViewContent" | "Schedule";
  event_time: number;
  event_id: string;
  action_source: "website";
  user_data: { em?: string[]; ph?: string[]; external_id: string[] };
  custom_data?: { currency: string; value: number };
};

/** Server worker only: credentials and hashed identities must never enter browser props. */
export async function sendMetaTrackingEvent(input: {
  pixelId: string;
  apiVersion: string;
  token: string;
  testEventCode: string;
  event: MetaEvent;
  attempt: number;
  now: Date;
}): Promise<TrackingDeliveryDecision> {
  // Fixed provider origin and a required test code keep this first delivery
  // path in Meta test-events mode. No user-supplied URL or redirect is followed.
  if (!/^\d{5,32}$/u.test(input.pixelId) || !/^v\d{1,3}\.0$/u.test(input.apiVersion) ||
      !/^[A-Za-z0-9._~+/-]{16,4096}=*$/u.test(input.token) ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(input.testEventCode)) throw new TypeError("Invalid tracking transport binding.");
  // Validate the persisted attempt before any provider network operation.
  decideTrackingDelivery({ attempt: input.attempt, now: input.now, status: null, acceptedEvents: null });
  const response = await fetch(`https://graph.facebook.com/${input.apiVersion}/${input.pixelId}/events`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.token}` },
    body: JSON.stringify({ data: [input.event], test_event_code: input.testEventCode }),
  }).catch(() => null);
  if (!response) return decideTrackingDelivery({ attempt: input.attempt, now: input.now, status: null, acceptedEvents: null });
  let acceptedEvents: number | null = null;
  // Bound the response independently of Content-Length. Never log its body.
  const reader = response.body?.getReader();
  if (reader) {
    try {
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 65_536) { await reader.cancel(); break; }
        chunks.push(chunk.value);
      }
      if (length <= 65_536) {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (body && typeof body === "object" && "events_received" in body && typeof body.events_received === "number") acceptedEvents = body.events_received;
      }
    } catch { /* Invalid or interrupted provider responses never prove acceptance. */ }
    finally { reader.releaseLock(); }
  }
  return decideTrackingDelivery({ attempt: input.attempt, now: input.now, status: response.status, acceptedEvents });
}
