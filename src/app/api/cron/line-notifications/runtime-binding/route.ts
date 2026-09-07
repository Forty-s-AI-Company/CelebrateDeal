import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { requireCronSecret, unauthorizedJson } from "@/lib/api-security";
import { getDb } from "@/lib/db";

const SENTINEL_ID = /^line-e2e-v-[a-f0-9]{24}$/u;
const SENTINEL_CHALLENGE = /^[a-f0-9]{64}$/u;

/**
 * Proves that an exact Preview runtime and the trusted runner see the same DB.
 * It is disabled outside an explicitly configured Preview and performs no write.
 */
export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  if (process.env.VERCEL_ENV !== "preview" || process.env.LINE_STAGING_VALIDATION_ENABLED !== "true") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const sentinelId = request.headers.get("x-line-staging-sentinel-id") ?? "";
  const challenge = request.headers.get("x-line-staging-sentinel-challenge") ?? "";
  if (!SENTINEL_ID.test(sentinelId) || !SENTINEL_CHALLENGE.test(challenge)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const sentinel = await getDb().vendor.findFirst({
    where: { id: sentinelId, passwordHash: challenge },
    select: { id: true },
  });
  if (!sentinel) return NextResponse.json({ ok: false }, { status: 404 });
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false }, { status: 503 });
  const proof = createHmac("sha256", secret).update(`line-staging-runtime-binding:v1:${sentinelId}:${challenge}`).digest("hex");
  return NextResponse.json({ ok: true, proof });
}
