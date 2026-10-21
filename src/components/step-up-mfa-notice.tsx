import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { recentMfaRedirectPath, STEP_UP_MFA_MAX_AGE_MINUTES, type RecentMfaStatus } from "@/lib/recent-mfa";

/**
 * Tells the user before a high-risk form that the server will ask for a
 * recent MFA verification (F-027). The server guard is authoritative; this is
 * only the advance notice, so it renders nothing once the session is fresh.
 */
export function StepUpMfaNotice({
  status,
  nextPath,
  operation,
}: {
  status: RecentMfaStatus;
  nextPath: string;
  operation: string;
}) {
  if (status === "verified") return null;
  const setup = status === "setup_required";
  return (
    <div role="note" aria-label="需要驗證" className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <strong className="font-semibold">需要驗證：</strong>
          {setup
            ? `${operation}前需先啟用雙重驗證（MFA）。`
            : `${operation}前需在 ${STEP_UP_MFA_MAX_AGE_MINUTES} 分鐘內完成雙重驗證。`}
        </span>
      </p>
      <Link
        href={recentMfaRedirectPath(status, nextPath)}
        prefetch={false}
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md border border-amber-300 bg-white px-3 font-semibold text-amber-900 hover:bg-amber-100"
      >
        {setup ? "前往啟用" : "立即驗證"}
      </Link>
    </div>
  );
}
