export type CloudflareVideoStatus = "processing" | "ready" | "error";

/**
 * Cloudflare delivery can be retried out of order. Ready is terminal for the
 * current asset, while an error may still recover when a later ready event
 * arrives. This keeps stale callbacks from regressing usable playback.
 */
export function resolveCloudflareVideoStatusTransition(
  currentStatus: string,
  incomingStatus: CloudflareVideoStatus,
): CloudflareVideoStatus | null {
  // A soft archive is an application-owned lifecycle state. Provider
  // callbacks may refresh metadata, but they must never silently restore the
  // video or make it eligible for a new Live/registration binding.
  if (currentStatus === "archived") return null;
  if (currentStatus === "ready" && incomingStatus !== "ready") return null;
  if (currentStatus === "error" && incomingStatus === "processing") return null;
  return incomingStatus;
}
