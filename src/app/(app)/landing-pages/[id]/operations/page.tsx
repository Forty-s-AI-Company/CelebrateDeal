import { FunnelOperationsPanel } from "@/components/landing-pages/funnel-operations-panel";
import FunnelOperationsUnavailable from "./unavailable";
import { FunnelOperationsError, loadFunnelOperations, loadFunnelReports } from "@/lib/funnel-operations-service";
import { CSRF_FIELD_NAME, getCsrfToken } from "@/lib/csrf";

export default async function FunnelOperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Missing/foreign resources share the same expected unavailable state. Do not
  // interrupt an already-streaming authenticated layout with an HTTP fallback.
  const initial = await loadFunnelOperations(id).catch((error: unknown) => { if (error instanceof FunnelOperationsError) return null; throw error; });
  if (!initial) return <FunnelOperationsUnavailable />;
  const initialReports = await loadFunnelReports(id);
  return <FunnelOperationsPanel initial={initial} initialReports={initialReports} csrfName={CSRF_FIELD_NAME} csrfToken={await getCsrfToken()} />;
}
