import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { TeamFunnelAccessDeniedError } from "@/lib/team-funnel-access";
import { TeamFunnelConflictError, publishTeamFunnelTemplateVersion } from "@/lib/team-funnel-pages";
import { teamFunnelProductSlotKeys } from "@/lib/team-funnel-product-slots";

const identifierSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u);

function emptyTextToNull(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

const productSlotsSchema = z.array(z.object({
  slotKey: z.enum(teamFunnelProductSlotKeys),
  productId: identifierSchema,
  offerLabel: z.preprocess(emptyTextToNull, z.string().trim().max(200).nullable().optional()),
})).max(teamFunnelProductSlotKeys.length).superRefine((slots, context) => {
  const seen = new Set<string>();
  slots.forEach((slot, index) => {
    if (seen.has(slot.slotKey)) {
      context.addIssue({
        code: "custom",
        message: "Product slot keys must be unique.",
        path: [index, "slotKey"],
      });
    }
    seen.add(slot.slotKey);
  });
});

const payloadSchema = z.object({
  action: z.literal("publish"),
  teamId: z.string().min(1).max(100),
  templateId: z.string().min(1).max(100),
  content: z.object({
    headline: z.string().trim().min(1).max(500),
    subheadline: z.string().trim().max(2_000).nullable().optional(),
    body: z.string().trim().max(20_000).nullable().optional(),
    ctaLabel: z.string().trim().min(1).max(200),
    ctaUrl: z.string().trim().url().max(2_000).nullable().optional(),
  }),
  lockedFields: z.array(z.enum(["HEADLINE", "SUBHEADLINE", "BODY", "CTA_LABEL", "CTA_URL", "PRODUCT_SLOTS"])).max(6).optional(),
  // The service treats an omitted selection as an empty list. Requiring this
  // field prevents older clients from silently removing every product slot;
  // callers can still send [] when clearing the slots is intentional.
  productSlots: productSlotsSchema,
  sourcePage: z.object({
    pageId: identifierSchema,
    slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    webinarId: z.preprocess(emptyTextToNull, identifierSchema.nullable().optional()),
  }).optional(),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const parsed = payloadSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return jsonError("INVALID_REQUEST", 400);

  try {
    const result = await publishTeamFunnelTemplateVersion(parsed.data);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    // Do not distinguish a foreign tenant's template from an absent one.
    if (error instanceof TeamFunnelAccessDeniedError) return jsonError("TEAM_FUNNEL_NOT_FOUND", 404);
    if (error instanceof TeamFunnelConflictError) return jsonError("TEAM_FUNNEL_CONFLICT", 409);
    return jsonError("TEAM_FUNNEL_WRITE_FAILED", 500);
  }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}
