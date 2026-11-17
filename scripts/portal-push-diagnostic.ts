/**
 * Closed-vocabulary diagnostic for the portal worker push browser test. Only
 * fixed states, booleans and bounded counters are kept; never URLs, payloads,
 * registration identifiers, browser error text or account data.
 */
export const PORTAL_PUSH_ANNOTATION_TYPE = "portal-push-diagnostic";

const registrationErrors = ["none", "TypeError", "SecurityError", "InvalidStateError", "AbortError", "other"] as const;
const workerStatuses = ["new", "installing", "installed", "activating", "activated", "redundant"] as const;
const runningStatuses = ["stopped", "starting", "running", "stopping"] as const;
const stages = ["setup", "ready", "delivered", "displayed", "done"] as const;
const showOutcomes = ["none", "pending", "ok", "TypeError", "NotAllowedError", "AbortError", "other"] as const;

type Stage = typeof stages[number];

export type PortalPushDiagnosticInput = {
  stage: Stage;
  registration: { attempted: unknown; accepted: unknown; error: unknown } | null;
  workerState: unknown;
  /** Push events the in-worker observer saw; null when the observer is unavailable or was reset by a worker restart. */
  pushEvents: number | null;
  /** The worker's showNotification() outcome; null when the observer is unavailable. */
  show: unknown;
  /** Most notifications any page-side getNotifications() read returned; null when never read. */
  notifications: number | null;
  waitedMs: number | null;
};

const count = (value: number | null) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? String(Math.min(value, 9)) : "x";
const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: string) => typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : fallback;

export function formatPortalPushDiagnostic(input: PortalPushDiagnosticInput) {
  const registration = input.registration && typeof input.registration.attempted === "boolean" && typeof input.registration.accepted === "boolean"
    ? `${input.registration.attempted ? 1 : 0}${input.registration.accepted ? 1 : 0}-${pick(registrationErrors, input.registration.error, "other")}`
    : "x";
  const [status, running] = typeof input.workerState === "string" ? input.workerState.split("/") : [];
  const worker = (workerStatuses as readonly string[]).includes(status ?? "") && (runningStatuses as readonly string[]).includes(running ?? "") ? `${status}/${running}` : "none";
  const waited = typeof input.waitedMs === "number" && Number.isFinite(input.waitedMs) && input.waitedMs >= 0 ? String(Math.min(Math.round(input.waitedMs), 999_999)) : "x";
  return `PORTAL_PUSH:${pick(stages, input.stage, "setup")}:R${registration}:W${worker}:P${count(input.pushEvents)}:S${input.show === null || input.show === undefined ? "x" : pick(showOutcomes, input.show, "other")}:N${count(input.notifications)}:T${waited}`;
}

const diagnosticPattern = new RegExp(
  `^PORTAL_PUSH:(${stages.join("|")}):R(x|[01]{2}-(?:${registrationErrors.join("|")})):W(none|(?:${workerStatuses.join("|")})/(?:${runningStatuses.join("|")})):P([0-9x]):S(x|${showOutcomes.join("|")}):N([0-9x]):T(x|[0-9]{1,6})$`,
  "u",
);

export function classifyPortalPushDiagnostic(value: unknown) {
  if (typeof value !== "string" || value.length > 160) return null;
  const match = diagnosticPattern.exec(value);
  if (!match) return null;
  const [, stage, registration, worker, pushEvents, show, notifications, waited] = match;
  return `portal_push stage=${stage} registration=${registration} worker=${worker} push_events=${pushEvents} show=${show} notifications=${notifications} waited_ms=${waited}`;
}
