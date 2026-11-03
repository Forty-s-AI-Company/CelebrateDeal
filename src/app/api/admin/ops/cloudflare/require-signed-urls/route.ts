import { NextResponse } from "next/server";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { writeAuditLog } from "@/lib/audit";
import { CloudflareStreamError } from "@/lib/cloudflare-stream";
import {
  backfillStreamSignedUrls,
  SignedUrlBackfillNotConfiguredError,
  SignedUrlBackfillRequest,
  type SignedUrlBackfillAudit,
} from "@/lib/cloudflare-stream-signed-url-backfill";

export const runtime = "nodejs";
// At most 5 videos per batch, each with up to three 15 s Cloudflare calls
// (live input GET + PUT, recorded video POST).
export const maxDuration = 300;

const noStore = { "Cache-Control": "private, no-store" };

/** Audit row without tokens or keys: vendor, mode, origins and per-resource outcome. */
const auditBackfill: SignedUrlBackfillAudit = async ({ vendorId, mode, allowedOrigins, results }) => {
  await writeAuditLog({
    vendorId,
    actorLabel: "ops:job_secret",
    action: mode === "lock" ? "cloudflare_stream.require_signed_urls" : "cloudflare_stream.allow_public_urls",
    targetType: "vendor",
    targetId: vendorId,
    after: {
      mode,
      allowedOrigins,
      results: results.map(({ videoId, kind, uid, status, diagnostic, providerStatus }) => ({
        videoId,
        kind,
        uid,
        status,
        ...(diagnostic ? { diagnostic } : {}),
        ...(providerStatus !== undefined ? { providerStatus } : {}),
      })),
    },
  });
};

/**
 * F-093：對單一 vendor 的既有 Cloudflare Stream 影片批次開啟（lock）或關閉
 * （unlock，回滾）requireSignedURLs。預設 dry-run；lock 的 `apply: true` 需要已
 * 設定 Stream 簽章金鑰。
 */
export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = SignedUrlBackfillRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid signed URL backfill request" }, { status: 400, headers: noStore });
  }

  try {
    const result = await backfillStreamSignedUrls(parsed.data, { audit: auditBackfill });
    return NextResponse.json({ ok: true, helper: "admin_ops_cloudflare_require_signed_urls", ...result }, { headers: noStore });
  } catch (error) {
    if (error instanceof SignedUrlBackfillNotConfiguredError) {
      return NextResponse.json(
        { ok: false, error: "Stream signing is not configured", diagnostic: "signing_not_configured" },
        { status: 409, headers: noStore },
      );
    }
    if (error instanceof CloudflareStreamError && error.code === "configuration") {
      return NextResponse.json(
        { ok: false, error: "Cloudflare Stream is not configured", diagnostic: "configuration" },
        { status: 503, headers: noStore },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Signed URL backfill failed", diagnostic: "unexpected" },
      { status: 500, headers: noStore },
    );
  }
}
