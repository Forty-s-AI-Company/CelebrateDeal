import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  createTeamFunnelLiveShare,
  disableTeamFunnelLiveShare,
  TeamFunnelLiveShareConflictError,
  TeamFunnelLiveShareUnavailableError,
} from "@/lib/team-funnel-live-sharing";

const createSchema = z.object({
  action: z.literal("create"),
  teamId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
  promoterMembershipId: z.string().min(1).max(100),
  expiresAt: z.coerce.date().nullable().optional(),
});
const disableSchema = z.object({
  action: z.literal("disable"),
  teamId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
  promoterMembershipId: z.string().min(1).max(100),
});
const payloadSchema = z.discriminatedUnion("action", [createSchema, disableSchema]);

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError("INVALID_REQUEST", 400);

  try {
    const data = parsed.data.action === "create"
      ? await createTeamFunnelLiveShare(parsed.data)
      : await disableTeamFunnelLiveShare(parsed.data);
    return NextResponse.json({ data }, { status: parsed.data.action === "create" ? 201 : 200 });
  } catch (error) {
    if (error instanceof TeamFunnelAccessDeniedError) return jsonError("TEAM_FUNNEL_NOT_FOUND", 404);
    if (error instanceof TeamFunnelLiveShareUnavailableError) return jsonError("TEAM_FUNNEL_LIVE_SHARE_NOT_FOUND", 404);
    if (error instanceof TeamFunnelLiveShareConflictError) return jsonError(error.code, 409);
    return jsonError("TEAM_FUNNEL_LIVE_SHARE_WRITE_FAILED", 500);
  }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
