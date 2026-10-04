import { safeMfaReturnPath } from "@/lib/mfa-return-path";

/** Preserve only validated in-app navigation across native MFA form posts. */
export function MfaReturnField({ nextPath }: { nextPath?: string }) {
  const next = safeMfaReturnPath(nextPath);
  return next ? <input type="hidden" name="next" value={next} /> : null;
}
