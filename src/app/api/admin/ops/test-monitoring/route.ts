import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { captureOperationalError } from "@/lib/monitoring";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  captureOperationalError(new Error("CelebrateDeal synthetic monitoring smoke test"), {
    source: "admin_ops",
    checkedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
