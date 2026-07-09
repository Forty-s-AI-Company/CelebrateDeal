type CaptureEventInput = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

export async function captureProductEvent(input: CaptureEventInput) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

  if (!key) return { skipped: true };

  const response = await fetch(`${host.replace(/\/$/, "")}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      distinct_id: input.distinctId,
      event: input.event,
      properties: input.properties ?? {},
    }),
  });

  if (!response.ok) {
    throw new Error(`PostHog capture failed: ${await response.text()}`);
  }

  return { skipped: false };
}
