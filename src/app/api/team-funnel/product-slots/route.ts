import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import {
  TeamFunnelInvalidProductSlotError,
  TeamFunnelInvalidProductUrlError,
  TeamFunnelPartnerProfileError,
  TeamFunnelProductSlotConflictError,
  createTeamFunnelTemplateProductSlot,
  resolvePersistedTeamFunnelProductSlots,
  upsertTeamFunnelPartnerProductSlotOverride,
} from "@/lib/team-funnel-product-slots";

const slotSchema = z.enum(["main_product", "bundle_product", "join_member", "consultation"]);
const setTemplateDefaultSchema = z.object({
  action: z.literal("set-template-default"),
  teamId: z.string().min(1).max(100),
  templateVersionId: z.string().min(1).max(100),
  slotKey: slotSchema,
  productId: z.string().min(1).max(100),
  offerLabel: z.string().trim().min(1).max(200).nullable().optional(),
});
const setOverrideSchema = z.object({
  action: z.literal("set-override"),
  teamId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
  slotKey: slotSchema,
  productId: z.string().min(1).max(100).nullable().optional(),
  overrideUrl: z.string().max(2_000).nullable().optional(),
}).refine((value) => value.productId != null || value.overrideUrl != null, { message: "An override value is required" });
const resolveSchema = z.object({
  action: z.literal("resolve"),
  teamId: z.string().min(1).max(100),
  pageId: z.string().min(1).max(100),
});
const payloadSchema = z.discriminatedUnion("action", [setTemplateDefaultSchema, setOverrideSchema, resolveSchema]);

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError("INVALID_REQUEST", 400);

  try {
    switch (parsed.data.action) {
      case "set-template-default":
        return NextResponse.json({ data: await createTeamFunnelTemplateProductSlot(parsed.data) }, { status: 201 });
      case "set-override":
        return NextResponse.json({ data: await upsertTeamFunnelPartnerProductSlotOverride(parsed.data) });
      case "resolve":
        return NextResponse.json({ data: await resolvePersistedTeamFunnelProductSlots(parsed.data) });
    }
  } catch (error) {
    if (error instanceof TeamFunnelAccessDeniedError) return jsonError("TEAM_FUNNEL_NOT_FOUND", 404);
    if (error instanceof TeamFunnelInvalidProductUrlError || error instanceof TeamFunnelInvalidProductSlotError) {
      return jsonError(error.code, 400);
    }
    if (error instanceof TeamFunnelProductSlotConflictError || error instanceof TeamFunnelPartnerProfileError) {
      return jsonError(error.code, 409);
    }
    return jsonError("TEAM_FUNNEL_PRODUCT_SLOT_WRITE_FAILED", 500);
  }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
