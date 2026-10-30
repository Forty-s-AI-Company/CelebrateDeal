import { FunnelOperationsPanel } from "@/components/landing-pages/funnel-operations-panel";
import FunnelOperationsUnavailable from "./unavailable";
import { FunnelOperationsError, loadFunnelOperations } from "@/lib/funnel-operations-service";
import { getLandingPagePublicationStatus } from "@/lib/landing-page-service";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";
import { requireVendorManager } from "@/lib/auth";
import { listStepTemplateOptions } from "@/lib/funnel-step-template-options";

export default async function FunnelOperationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  await requireVendorManager();
  // Missing/foreign resources share the same expected unavailable state. Do not
  // interrupt an already-streaming authenticated layout with an HTTP fallback.
  const initial = await loadFunnelOperations(id).catch((error: unknown) => { if (error instanceof FunnelOperationsError) return null; throw error; });
  if (!initial) return <FunnelOperationsUnavailable />;
  // Informational only (same tenant/project-scoped diagnosis as the editor);
  // a failed read keeps management usable and simply hides the details.
  const publication = await getLandingPagePublicationStatus(initial.pageId).catch(() => undefined);
  const query = await searchParams;
  const requestedStep = typeof query?.step === "string" ? query.step : undefined;
  const requestedStepExists = Boolean(requestedStep && initial.content.flow.steps.some((step) => step.id === requestedStep));
  const initialStepId = requestedStepExists
    ? requestedStep!
    : initial.content.flow.steps.find((step) => !step.isSystem)?.id ?? initial.content.activeStepId;
  return <FunnelOperationsPanel initial={initial} initialStepId={initialStepId} initialPublication={publication} templateOptions={listStepTemplateOptions(initial.content.flow.goal)} csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} />;
}
