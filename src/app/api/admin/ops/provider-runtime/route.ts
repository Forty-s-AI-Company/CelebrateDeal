import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { getProviderRuntimeIdentity } from "@/lib/provider-runtime-identity";
import { probeProviderReadOnly } from "@/lib/provider-readonly-probe";
import { resolveWp4ExpectedSourceSha, wp4SourceMatchesRequest } from "@/lib/wp4-preview-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read only the deployed Preview process bindings after JOB_SECRET authorization. */
export const GET = async (request: Request) => {
  if (!requireJobSecret(request)) return unauthorizedJson();

  const headers = { "Cache-Control": "no-store" };
  if (process.env.VERCEL_ENV !== "preview") {
    return NextResponse.json({ error: "Preview runtime required" }, { status: 403, headers });
  }

  const identity = getProviderRuntimeIdentity();
  if (new URL(request.url).searchParams.get("probe") !== "read-only") {
    return NextResponse.json(identity, { headers });
  }

  // A request for live provider access must name the exact deployed source.
  const sourceSha = resolveWp4ExpectedSourceSha();
  if (!sourceSha || !wp4SourceMatchesRequest(request, sourceSha)) {
    return NextResponse.json({ error: "Source mismatch" }, { status: 403, headers });
  }

  const result = await probeProviderReadOnly();
  return NextResponse.json({
    ...identity,
    evidence: "provider_read_only_probe",
    providerProbe: "completed",
    nonProductionScope: "unverified",
    probe: result,
  }, { headers });
};
