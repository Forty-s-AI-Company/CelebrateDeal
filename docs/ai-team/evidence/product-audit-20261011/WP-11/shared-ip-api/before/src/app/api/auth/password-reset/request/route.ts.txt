import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { schedulePasswordResetLink } from "@/lib/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";

const PasswordResetRequest = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "password-reset-request", 5, 60_000);
  if (limited) return limited;

  const parsed = PasswordResetRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid password reset request" }, { status: 400 });
  }

  let appUrl: string;
  try {
    appUrl = getCanonicalAppUrl();
  } catch {
    // Keep the anonymous response generic without falling back to the
    // attacker-controlled request Host when Production is misconfigured.
    return NextResponse.json({ ok: true });
  }

  schedulePasswordResetLink({
    email: parsed.data.email,
    appUrl,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true });
}
