import { FunnelOperationsError, loadFunnelReports } from "@/lib/funnel-operations-service";

const headers = { "Cache-Control": "private, no-store" };

/** A scoped read keeps slow reports out of the editor's navigation path. */
export async function GET(request: Request) {
  const pageId = new URL(request.url).searchParams.get("pageId") ?? "";
  try {
    return Response.json(await loadFunnelReports(pageId), { headers });
  } catch (error) {
    if (error instanceof FunnelOperationsError) {
      return Response.json({ error: "UNAVAILABLE" }, { status: 404, headers });
    }
    throw error;
  }
}
