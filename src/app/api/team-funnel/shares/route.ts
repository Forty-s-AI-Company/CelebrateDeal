import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  createTeamFunnelShare,
  disableTeamFunnelShare,
  TeamFunnelShareConflictError,
} from "@/lib/team-funnel-sharing";

const audienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("DIRECT_DOWNLINE") }),
  z.object({ type: z.literal("MEMBER"), membershipId: z.string().min(1).max(100) }),
]);
const createSchema = z.object({
  action: z.literal("create"),
  teamId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
  expiresAt: z.coerce.date().nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  audience: audienceSchema.optional(),
});
const disableSchema = z.object({ action: z.literal("disable"), teamId: z.string().min(1).max(100), pageId: z.string().min(1).max(100) });
const payloadSchema = z.discriminatedUnion("action", [createSchema, disableSchema]);

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError("INVALID_REQUEST", 400);
  try {
    const data = parsed.data.action === "create" ? await createTeamFunnelShare(parsed.data) : await disableTeamFunnelShare(parsed.data);
    return NextResponse.json({ data }, { status: parsed.data.action === "create" ? 201 : 200 });
  } catch (error) {
    if (error instanceof TeamFunnelAccessDeniedError) return jsonError("TEAM_FUNNEL_NOT_FOUND", 404);
    if (error instanceof TeamFunnelShareConflictError) return jsonError(error.code, 409);
    return jsonError("TEAM_FUNNEL_SHARE_WRITE_FAILED", 500);
  }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
