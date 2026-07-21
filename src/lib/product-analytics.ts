type CaptureEventInput = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

export async function captureProductEvent(input: CaptureEventInput) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";

  if (!key) return { skipped: true };

  let response: Response;
  try {
    response = await fetch(`${host.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        distinct_id: input.distinctId,
        event: input.event,
        properties: input.properties ?? {},
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new Error("PostHog capture failed (network).");
  }

  if (!response.ok) {
    throw new Error(`PostHog capture failed (provider_rejected:${response.status}).`);
  }

  return { skipped: false };
}
