import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { sendTransactionalEmail } from "@/lib/email";

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

  const result = await sendTransactionalEmail({
    to: parsed.data.to,
    subject: "CelebrateDeal production email smoke test",
    text: "If you received this email, Resend is wired correctly.",
  });

  return NextResponse.json({ ok: true, result });
}
