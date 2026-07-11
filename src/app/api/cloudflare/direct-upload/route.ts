import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { createDirectUploadMapping, DirectUploadRequest } from "@/lib/cloudflare-ops";
import { auditEntitlementDenial, VendorEntitlementError } from "@/lib/entitlements";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = DirectUploadRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid upload request" }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof createDirectUploadMapping>>;
  try {
    result = await createDirectUploadMapping(parsed.data);
  } catch (error) {
    if (!(error instanceof VendorEntitlementError)) throw error;
    await auditEntitlementDenial({ vendorId: parsed.data.vendorId, actorLabel: "cloudflare_job", error });
    return NextResponse.json({ error: "Vendor subscription or quota does not allow uploads", reason: error.reason }, { status: 402 });
  }
  const { video, upload } = result;

  return NextResponse.json({
    ok: true,
    videoId: video.id,
    upload: {
      uid: upload.uid,
      uploadURL: upload.uploadURL,
    },
  });
}
