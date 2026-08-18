import {
  LIVE_STUDIO_FLOW_VERSION,
  type LiveStudioDraftEnvelope,
  type LiveStudioDraftPayload,
  LiveStudioDraftPayloadSchema,
} from "@/lib/live-studio-draft";

export class LiveStudioDraftClientError extends Error {
  constructor(public readonly code: string) {
    super(`Live Studio draft request failed (${code}).`);
    this.name = "LiveStudioDraftClientError";
  }
}

function stringValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function serializeLiveStudioDraft(form: HTMLFormElement, activeStep: number): LiveStudioDraftPayload {
  const data = new FormData(form);
  return liveStudioDraftFromFormData(data, activeStep);
}

export function liveStudioDraftFromFormData(data: FormData, activeStep: number): LiveStudioDraftPayload {
  return LiveStudioDraftPayloadSchema.parse({
    flowVersion: LIVE_STUDIO_FLOW_VERSION,
    studioPreset: stringValue(data, "studioPreset") || "CUSTOM",
    title: stringValue(data, "title"),
    slug: stringValue(data, "slug"),
    scheduledAt: stringValue(data, "scheduledAt"),
    description: stringValue(data, "description"),
    productIds: data.getAll("productIds").filter((value): value is string => typeof value === "string"),
    accentCopy: stringValue(data, "accentCopy"),
    formId: stringValue(data, "formId"),
    messageTemplateId: stringValue(data, "messageTemplateId"),
    liveReminderTemplateId: stringValue(data, "liveReminderTemplateId"),
    liveReminderOffsetMinutes: stringValue(data, "liveReminderOffsetMinutes") || "60",
    streamMode: stringValue(data, "streamMode"),
    videoId: stringValue(data, "videoId"),
    heroImageUrl: stringValue(data, "heroImageUrl"),
    heroImageAssetId: stringValue(data, "heroImageAssetId"),
    interactionScriptId: stringValue(data, "interactionScriptId"),
    affiliateMode: stringValue(data, "affiliateMode"),
    defaultAffiliateCode: stringValue(data, "defaultAffiliateCode"),
    maxConcurrentViewers: stringValue(data, "maxConcurrentViewers"),
    stopWhenCreditsBelow: stringValue(data, "stopWhenCreditsBelow"),
    usageAttributionMode: stringValue(data, "usageAttributionMode"),
    quotaPayerScope: stringValue(data, "quotaPayerScope"),
    splitOwnerBps: stringValue(data, "splitOwnerBps"),
    splitPromoterBps: stringValue(data, "splitPromoterBps"),
    customAllocations: stringValue(data, "customAllocations"),
    memberQuotas: stringValue(data, "memberQuotas"),
    pageQuotas: stringValue(data, "pageQuotas"),
    replayEnabled: data.get("replayEnabled") === "on",
    activeStep,
  });
}

function errorCode(value: unknown) {
  if (!value || typeof value !== "object") return "draft_save_failed";
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return "draft_save_failed";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && /^[a-z0-9_]{1,64}$/i.test(code)
    ? code.toLowerCase()
    : "draft_save_failed";
}

export async function saveLiveStudioDraft({
  csrfToken,
  draftId,
  liveId,
  revision,
  payload,
}: {
  csrfToken: string;
  draftId: string;
  liveId: string;
  revision: number | null;
  payload: LiveStudioDraftPayload;
}): Promise<LiveStudioDraftEnvelope> {
  let response: Response;
  try {
    response = await fetch("/api/live-studio/drafts", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-celebratedeal-client": "web",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ draftId, liveId, revision, payload }),
    });
  } catch {
    throw new LiveStudioDraftClientError("network_error");
  }

  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new LiveStudioDraftClientError(errorCode(body));
  if (!body || typeof body !== "object") throw new LiveStudioDraftClientError("invalid_response");
  const record = body as Record<string, unknown>;
  const parsedPayload = LiveStudioDraftPayloadSchema.safeParse(record.payload);
  if (
    typeof record.id !== "string"
    || typeof record.revision !== "number"
    || !Number.isInteger(record.revision)
    || record.revision < 1
    || typeof record.updatedAt !== "string"
    || !parsedPayload.success
  ) {
    throw new LiveStudioDraftClientError("invalid_response");
  }
  return { id: record.id, revision: record.revision, updatedAt: record.updatedAt, payload: parsedPayload.data };
}
