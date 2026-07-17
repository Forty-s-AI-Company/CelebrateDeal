import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import { TeamFunnelPartnerProfileError, getTeamFunnelPartnerProfile } from "@/lib/team-funnel-product-slots";

const payloadSchema = z.object({
  action: z.literal("get"),
  teamId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError("INVALID_REQUEST", 400);

  try {
    return NextResponse.json({ data: await getTeamFunnelPartnerProfile(parsed.data) });
  } catch (error) {
    if (error instanceof TeamFunnelAccessDeniedError) return jsonError("TEAM_FUNNEL_NOT_FOUND", 404);
    if (error instanceof TeamFunnelPartnerProfileError) return jsonError(error.code, 409);
    return jsonError("TEAM_FUNNEL_PROFILE_READ_FAILED", 500);
  }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
