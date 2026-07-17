import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  claimTeamFunnelShare,
  TeamFunnelShareConflictError,
  TeamFunnelShareUnavailableError,
} from "@/lib/team-funnel-sharing";

const payloadSchema = z.object({
  teamId: z.string().min(1).max(100),
  shareCode: z.string().min(40).max(2_000),
  mode: z.enum(["QUICK_APPLY", "COPY_THEN_EDIT", "BLANK_PAGE_BOUND_TO_A_WEBINAR"]),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError("INVALID_REQUEST", 400);
  try {
    const data = await claimTeamFunnelShare(parsed.data);
    return NextResponse.json({ data }, { status: data.duplicate ? 200 : 201 });
  } catch (error) {
    // Invalid, expired, disabled, foreign-team, and wrong-member codes deliberately share one response.
    if (error instanceof TeamFunnelAccessDeniedError || error instanceof TeamFunnelShareUnavailableError) return jsonError("TEAM_FUNNEL_SHARE_NOT_FOUND", 404);
    if (error instanceof TeamFunnelShareConflictError) return jsonError(error.code, 409);
    return jsonError("TEAM_FUNNEL_COPY_WRITE_FAILED", 500);
  }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
