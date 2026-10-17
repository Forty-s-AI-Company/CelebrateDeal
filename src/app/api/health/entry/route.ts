import { entryReadiness } from "@/lib/entry-readiness";

/** 部署 smoke 必須同時檢查此設定狀態及實際來源 probe，不存取業務資料。 */
export function GET() {
  const state = entryReadiness();
  return Response.json({ ok: state.ready, entry: state.reason, topologyProbeRequired: true }, {
    status: state.ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
