import type { MetricSessionAuthorizer } from "./live-metric-session";
import { chatSessionTokenFromRequest, resolveVerifiedPrivateChatViewer } from "./live-chat";
import { liveViewerTokenFromRequest, hashLiveViewerToken } from "./live-quota-admission";
import { MetricIngestError } from "./live-metric-ingestion";

/** Shared by issuance and the read-only readiness hint. Never return browser
 * credentials or viewer information from the readiness endpoint.
 */
export function metricRequestAuthorizer(request: Request, scope: { vendorId: string; liveId: string }, ipAddress: string): MetricSessionAuthorizer {
  const admissionToken = liveViewerTokenFromRequest(request);
  const chatSessionToken = chatSessionTokenFromRequest(request);
  if (!admissionToken || !chatSessionToken) throw new MetricIngestError("not_authorized");
  return async tx => {
    const viewer = await resolveVerifiedPrivateChatViewer(tx, { ...scope, admissionToken, chatSessionToken, ipAddress });
    const admission = await tx.liveViewerSession.findUnique({ where: { tokenHash: hashLiveViewerToken(admissionToken) },
      select: { id: true, vendorId: true, liveId: true } });
    if (!admission || admission.vendorId !== scope.vendorId || admission.liveId !== scope.liveId) throw new MetricIngestError("not_authorized");
    return { ...scope, submissionId: viewer.submissionId, admissionId: admission.id };
  };
}
