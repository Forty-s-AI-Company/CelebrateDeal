import Link from "next/link";
import { cookies } from "next/headers";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import {
  FORM_SUBMISSION_CHAT_SESSION_COOKIE,
  verifyFormSubmissionChatSessionToken,
} from "@/lib/form-submission-chat-session";
import { buildGoogleCalendarUrl, buildLiveCalendarIcs } from "@/lib/live-calendar-event";

const linkClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2";

/**
 * 確認完成後的下一步：前往直播間、加入行事曆。
 * 只信任簽章過的報名 session cookie，查詢綁定該筆已驗證報名自己的場次，
 * 且場次必須屬於同一張表單與同一個商家；query string 不會授予任何資訊。
 */
export async function VerifiedRegistrationNextSteps() {
  const token = (await cookies()).get(FORM_SUBMISSION_CHAT_SESSION_COOKIE)?.value;
  if (!token) return null;
  const claim = verifyFormSubmissionChatSessionToken(token);
  if (!claim) return null;
  const submission = await getDb().formSubmission.findFirst({
    where: { id: claim.submissionId, verificationStatus: "VERIFIED", verifiedAt: { not: null } },
    select: {
      formId: true,
      form: { select: { vendorId: true } },
      live: {
        select: {
          id: true,
          slug: true,
          title: true,
          scheduledAt: true,
          status: true,
          formId: true,
          vendorId: true,
        },
      },
    },
  });
  const live = submission?.live;
  if (
    !submission
    || !live
    || live.formId !== submission.formId
    || live.vendorId !== submission.form.vendorId
    || (live.status !== "scheduled" && live.status !== "live")
  ) return null;

  const liveUrl = new URL(`/live/${encodeURIComponent(live.slug)}`, getCanonicalAppUrl()).href;
  const event = { uid: live.id, title: live.title, startsAt: live.scheduledAt, url: liveUrl };
  const icsHref = `data:text/calendar;charset=utf-8,${encodeURIComponent(buildLiveCalendarIcs(event))}`;
  const when = new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(live.scheduledAt);

  return (
    <section aria-label="報名後的下一步" className="mt-5 grid gap-3">
      <p className="text-sm leading-6">
        {live.title}｜{when}（台北時間）
      </p>
      <Link
        href={`/live/${encodeURIComponent(live.slug)}`}
        prefetch={false}
        className={`${linkClass} bg-blue-700 text-white hover:bg-blue-800`}
      >
        前往直播間
      </Link>
      <div className="grid gap-2 sm:grid-cols-2">
        <a
          href={buildGoogleCalendarUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${linkClass} border border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100`}
        >
          加入 Google 行事曆
        </a>
        <a
          href={icsHref}
          download="live-event.ics"
          className={`${linkClass} border border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100`}
        >
          下載行事曆檔（.ics）
        </a>
      </div>
    </section>
  );
}
