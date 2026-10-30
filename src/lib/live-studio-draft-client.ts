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

function fixedSessionsValue(formData: FormData) {
  const value = stringValue(formData, "fixedSessions");
  if (!value) return [];
  return JSON.parse(value) as unknown;
}

/** Only a fixed-session Live carries the 指定場次 keys (see the draft schema). */
function fixedSessionFields(data: FormData) {
  if (stringValue(data, "sessionMode") !== "fixed_sessions") return {};
  return {
    sessionMode: "fixed_sessions",
    fixedSessions: fixedSessionsValue(data),
    sessionRegistrationCutoffMinutes: stringValue(data, "sessionRegistrationCutoffMinutes"),
    sessionReplayWindowHours: stringValue(data, "sessionReplayWindowHours"),
  };
}

function notificationRulesValue(formData: FormData) {
  const value = stringValue(formData, "notificationRules");
  if (!value) return [];
  return JSON.parse(value) as unknown;
}

export function serializeLiveStudioDraft(form: HTMLFormElement, activeStep: number): LiveStudioDraftPayload {
  const data = new FormData(form);
  return liveStudioDraftFromFormData(data, activeStep);
}

export function liveStudioDraftFromFormData(data: FormData, activeStep: number): LiveStudioDraftPayload {
  const replayEnabled = data.get("replayEnabled") === "on";
  return LiveStudioDraftPayloadSchema.parse({
    flowVersion: LIVE_STUDIO_FLOW_VERSION,
    studioPreset: stringValue(data, "studioPreset") || "CUSTOM",
    title: stringValue(data, "title"),
    slug: stringValue(data, "slug"),
    scheduledAt: stringValue(data, "scheduledAt"),
    description: stringValue(data, "description"),
    productIds: data.getAll("productIds").filter((value): value is string => typeof value === "string"),
    accentCopy: stringValue(data, "accentCopy"),
    ...(stringValue(data, "projectId") ? { projectId: stringValue(data, "projectId") } : {}),
    formId: stringValue(data, "formId"),
    messageTemplateId: stringValue(data, "messageTemplateId"),
    liveReminderTemplateId: stringValue(data, "liveReminderTemplateId"),
    liveReminderOffsetMinutes: stringValue(data, "liveReminderOffsetMinutes") || "60",
    notificationRules: notificationRulesValue(data),
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
    replayEnabled,
    replayAvailableUntil: replayEnabled ? stringValue(data, "replayAvailableUntil") : "",
    ...fixedSessionFields(data),
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
  overwrite = false,
}: {
  csrfToken: string;
  draftId: string;
  liveId: string;
  revision: number | null;
  payload: LiveStudioDraftPayload;
  overwrite?: boolean;
}): Promise<LiveStudioDraftEnvelope & { slugTaken: boolean; slugCheckFailed: boolean }> {
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
      body: JSON.stringify({ draftId, liveId, revision, payload, ...(overwrite ? { overwrite: true } : {}) }),
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
  return {
    id: record.id,
    revision: record.revision,
    updatedAt: record.updatedAt,
    payload: parsedPayload.data,
    slugTaken: record.slugTaken === true,
    slugCheckFailed: record.slugCheckFailed === true,
  };
}

const INVALID_FIELD_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;

/** F-117: first failing form-control name from a zod error, safe to put in a redirect query. */
export function liveInvalidFieldName(error: unknown): string | null {
  const issues = typeof error === "object" && error !== null && "issues" in error
    ? (error as { issues?: unknown }).issues
    : null;
  if (!Array.isArray(issues)) return null;
  for (const issue of issues) {
    const path = typeof issue === "object" && issue !== null ? (issue as { path?: unknown }).path : null;
    const first = Array.isArray(path) ? path[0] : undefined;
    if (typeof first === "string" && INVALID_FIELD_NAME.test(first)) return first;
    // A union failure nests the candidate issues one level down.
    const nested = typeof issue === "object" && issue !== null ? (issue as { errors?: unknown }).errors : null;
    if (Array.isArray(nested)) {
      for (const group of nested) {
        const name = liveInvalidFieldName({ issues: group });
        if (name) return name;
      }
    }
  }
  return null;
}
