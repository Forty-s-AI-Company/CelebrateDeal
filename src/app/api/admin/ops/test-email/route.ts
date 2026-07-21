import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { getSmokeTestEmail, isAllowedSmokeTestRecipient, sendTransactionalEmail } from "@/lib/email";

const TestEmailRequest = z.object({
  to: z.string().email(),
});

export async function POST(request: Request) {
  if (!requireJobSecret(request)) {
    return unauthorizedJson();
  }

  const parsed = TestEmailRequest.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid test email request" }, { status: 400 });
  }

  const smokeTestEmail = getSmokeTestEmail();
  if (!smokeTestEmail) {
    return NextResponse.json({ error: "Test email recipient is not configured" }, { status: 503 });
  }
  if (!isAllowedSmokeTestRecipient(parsed.data.to)) {
    return NextResponse.json({ error: "Test email recipient is not allowed" }, { status: 403 });
  }

  try {
    await sendTransactionalEmail({
      to: smokeTestEmail,
      subject: "CelebrateDeal production email smoke test",
      text: "If you received this email, Resend is wired correctly.",
    });
  } catch {
    return NextResponse.json({ error: "Email provider request failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
