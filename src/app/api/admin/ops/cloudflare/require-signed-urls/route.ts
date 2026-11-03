import { NextResponse } from "next/server";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { CloudflareStreamError } from "@/lib/cloudflare-stream";
import {
  backfillStreamSignedUrls,
  SignedUrlBackfillNotConfiguredError,
  SignedUrlBackfillRequest,
} from "@/lib/cloudflare-stream-signed-url-backfill";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * F-093：對單一 vendor 的既有 Cloudflare Stream 影片批次開啟 requireSignedURLs。
 * 預設 dry-run；`apply: true` 需要已設定 Stream 簽章金鑰。
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
    const result = await backfillStreamSignedUrls(parsed.data);
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
