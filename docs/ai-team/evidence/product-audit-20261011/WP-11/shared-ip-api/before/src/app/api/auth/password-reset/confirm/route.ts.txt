import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { consumePasswordResetToken } from "@/lib/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";

const PasswordResetConfirm = z.object({
  token: z.string().min(24),
  password: z.string().min(12).max(160),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "password-reset-confirm", 10, 60_000);
  if (limited) return limited;

  const parsed = PasswordResetConfirm.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid password reset confirmation" }, { status: 400 });
  }

  const result = await consumePasswordResetToken(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
