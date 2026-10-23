import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { PASSWORD_INPUT_LIMIT, validateNewPassword } from "@/lib/password-policy";
import { consumePasswordResetToken, findPasswordResetTokenAccount } from "@/lib/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";

const PasswordResetConfirm = z.object({
  token: z.string().min(24),
  // Trim like the Server Actions and sign-in do, so the value checked is the
  // value stored. The policy, not the schema, decides short and long.
  password: z.string().max(PASSWORD_INPUT_LIMIT).transform((value) => value.trim()),
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
  const { token, password } = parsed.data;

  // An unusable token yields no account (8-character rule); consumePasswordResetToken still refuses it below.
  const policy = validateNewPassword(password, await findPasswordResetTokenAccount(token) ?? {});
  if (!policy.ok) {
    return NextResponse.json(
      { error: "Invalid password reset confirmation", reason: policy.reason, ...(policy.reason === "short" ? { minLength: policy.minLength } : {}) },
      { status: 400 },
    );
  }

  const result = await consumePasswordResetToken(token, password);
  if (!result.ok) {
    return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
