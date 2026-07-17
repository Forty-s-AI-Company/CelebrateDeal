import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import {
  TeamFunnelConflictError,
  copyTeamFunnelTemplateVersion,
  createTeamFunnelOriginalPage,
} from "@/lib/team-funnel-pages";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";

const fieldSchema = z.enum(["HEADLINE", "SUBHEADLINE", "BODY", "CTA_LABEL", "CTA_URL", "PRODUCT_SLOTS"]);
const contentSchema = z.object({
  headline: z.string().trim().min(1).max(500),
  subheadline: z.string().trim().max(2_000).nullable().optional(),
  body: z.string().trim().max(20_000).nullable().optional(),
  ctaLabel: z.string().trim().min(1).max(200),
  ctaUrl: z.string().trim().url().max(2_000).nullable().optional(),
});
const createSchema = z.object({
  action: z.literal("create"),
  teamId: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
  content: contentSchema,
  lockedFields: z.array(fieldSchema).max(6).optional(),
});
const copySchema = z.object({
  action: z.literal("copy"),
  teamId: z.string().min(1).max(100),
  templateVersionId: z.string().min(1).max(100),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
});
const payloadSchema = z.discriminatedUnion("action", [createSchema, copySchema]);

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError("INVALID_REQUEST", 400);

  try {
    const result = parsed.data.action === "create"
      ? await createTeamFunnelOriginalPage(parsed.data)
      : await copyTeamFunnelTemplateVersion(parsed.data);
    return NextResponse.json({ data: result }, { status: parsed.data.action === "create" ? 201 : 200 });
  } catch (error) {
    return teamFunnelErrorResponse(error);
  }
}

function teamFunnelErrorResponse(error: unknown) {
  // Deliberately identical for cross-tenant ids, missing resources, and denied ownership.
  if (error instanceof TeamFunnelAccessDeniedError) return jsonError("TEAM_FUNNEL_NOT_FOUND", 404);
  if (error instanceof TeamFunnelConflictError) return jsonError("TEAM_FUNNEL_CONFLICT", 409);
  return jsonError("TEAM_FUNNEL_WRITE_FAILED", 500);
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
