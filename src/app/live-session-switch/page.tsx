import type { Metadata } from "next";
import { NativePostForm } from "@/components/native-post-form";
import { verifyLiveSessionSwitchToken } from "@/lib/live-session-switch-token";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "更換報名場次",
  robots: { index: false, follow: false },
};

/**
 * Confirmation page of a 「更換場次」 link (指定場次). Opening it (or a mail
 * scanner fetching it) only checks the signature and expiry, without the
 * database; the link is redeemed by the POST button alone.
 */
export default async function LiveSessionSwitchPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; status?: string | string[] }>;
}) {
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : undefined;
  const status = typeof query.status === "string" ? query.status : undefined;
  const retry = status === "retry";
  const valid = !status && Boolean(verifyLiveSessionSwitchToken(token));

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-blue-700">CelebrateDeal 報名場次</p>
        {retry ? (
          <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <h1 className="text-xl font-black">目前較為忙碌，請重試</h1>
            <p className="mt-2 text-sm leading-6">你的更換場次連結仍然有效，請回到通知信再按一次連結。</p>
          </div>
        ) : valid && token ? (
          <>
            <h1 className="mt-4 text-2xl font-black text-slate-950">在這台裝置更換場次</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              按下確認後，這台裝置會被視為你報名時的裝置，並帶你回到報名頁。請用同一個 Email 選擇新的場次並送出，報名就會改到新場次。
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">這個連結只能使用一次。若不是你本人要求換場，請直接關閉此頁。</p>
            <NativePostForm
              action="/api/live-session-switch"
              idleLabel="確認並前往選擇場次"
              pendingLabel="確認中…"
              pendingMessage="正在確認，請勿重複送出。"
              className="mt-5"
              buttonClassName="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              <input type="hidden" name="token" value={token} />
            </NativePostForm>
          </>
        ) : (
          <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <h1 className="text-xl font-black">更換場次連結無效或已過期</h1>
            <p className="mt-2 text-sm leading-6">
              連結可能已使用過、超過 24 小時，或你的報名已換到其他場次。如仍需換場，請在原本報名的裝置上操作，或聯絡主辦單位。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
