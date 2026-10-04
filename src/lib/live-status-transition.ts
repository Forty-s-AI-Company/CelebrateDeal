import { redirect } from "next/navigation";

// Keep lifecycle validation separate from the legacy root action orchestrator.
const liveStatusTransitions: Readonly<Record<string, ReadonlySet<string>>> = {
  draft: new Set(["draft", "scheduled"]),
  scheduled: new Set(["draft", "scheduled", "live"]),
  live: new Set(["live", "ended"]),
  ended: new Set(["draft", "ended", "scheduled"]),
};

export function requestedLiveStatus(
  formData: FormData,
  liveId: string | null,
  draftId: string,
  currentStatus: string | null,
) {
  const submitted = formData.get("status");
  const status = typeof submitted === "string" ? submitted.trim() : "draft";
  const transitionAllowed = liveId
    ? Boolean(currentStatus && liveStatusTransitions[currentStatus]?.has(status))
    : status === "draft" || status === "scheduled";
  if (!transitionAllowed) {
    redirect(
      liveId
        ? `/lives/${encodeURIComponent(liveId)}/edit?error=invalid_status`
        : `/lives/new?error=invalid_status&draft=${encodeURIComponent(draftId)}`,
    );
  }
  return status;
}

