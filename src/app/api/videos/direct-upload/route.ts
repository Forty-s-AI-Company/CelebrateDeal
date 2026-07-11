import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/api-security";
import { writeAuditLog } from "@/lib/audit";
import { getCurrentAuth } from "@/lib/auth";
import { createDirectUploadMapping } from "@/lib/cloudflare-ops";
import { VendorEntitlementError } from "@/lib/entitlements";
import { checkRateLimit } from "@/lib/rate-limit";
import { canManageVideos } from "@/lib/vendor-capabilities";

const UploadPayload = z.object({
  title: z.string().trim().min(1).max(160),
  maxDurationSeconds: z.number().int().min(60).max(6 * 60 * 60),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const auth = await getCurrentAuth();
  if (!auth?.vendor || !auth.member || !canManageVideos(auth.member.role)) {
    return NextResponse.json({ error: "Video manager permission required" }, { status: 403 });
  }
  const limited = await checkRateLimit(request, `video-direct-upload:${auth.vendor.id}`, 5, 60_000, { scope: "global" });
  if (limited) return limited;
  const parsed = UploadPayload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });

  try {
    const { video, upload } = await createDirectUploadMapping({
      vendorId: auth.vendor.id,
      title: parsed.data.title,
      maxDurationSeconds: parsed.data.maxDurationSeconds,
    });
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "cloudflare_direct_upload_created",
      targetType: "Video",
      targetId: video.id,
      after: { sourceType: video.sourceType, status: video.status, maxDurationSeconds: parsed.data.maxDurationSeconds },
    });
    return NextResponse.json({ ok: true, videoId: video.id, uploadURL: upload.uploadURL });
  } catch (error) {
    const entitlement = error instanceof VendorEntitlementError;
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: "cloudflare_direct_upload_failed",
      targetType: "Video",
      after: { reason: entitlement ? error.reason : "provider_unavailable" },
    });
    return NextResponse.json(
      { error: entitlement ? "Subscription or quota does not allow uploads" : "Cloudflare upload is temporarily unavailable" },
      { status: entitlement ? 402 : 502 },
    );
  }
}
