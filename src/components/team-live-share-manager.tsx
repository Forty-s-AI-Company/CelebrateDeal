"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, Copy, Link2, RotateCcw, XCircle } from "lucide-react";
import {
  createTeamLiveShareAction,
  disableTeamLiveShareAction,
  initialTeamLiveShareActionState,
  type TeamLiveShareActionState,
} from "@/app/actions/team-funnel-live-share-actions";

export type TeamLiveShareTarget = {
  membershipId: string;
  label: string;
  email: string;
  activeShare: { expiresAt: string | null } | null;
};

export type TeamLiveSharePage = {
  id: string;
  teamId: string;
  slug: string;
  headline: string;
  liveTitle: string;
  liveStatus: string;
  targets: TeamLiveShareTarget[];
};

function actionMessage(state: TeamLiveShareActionState, pageId: string, promoterMembershipId: string) {
  return state.status !== "idle" && state.pageId === pageId && state.promoterMembershipId === promoterMembershipId
    ? state.message
    : null;
}

function statusLabel(status: string) {
  if (status === "live") return "直播中";
  if (status === "scheduled") return "即將直播";
  return "精彩回放";
}

function formatExpiry(value: string | null) {
  return value ? `到期 ${new Date(value).toLocaleDateString("zh-TW")}` : "未設定到期日";
}

type PendingShareOperation = { kind: "create" | "disable"; key: string } | null;
type CopyStatus = "idle" | "success" | "error";
type CopyFeedback = { status: Exclude<CopyStatus, "idle">; url: string } | null;

function shareOperationKey(pageId: string, membershipId: string) {
  return `${pageId}:${membershipId}`;
}

function operationIsPending(operation: PendingShareOperation, kind: NonNullable<PendingShareOperation>["kind"], key: string, pending: boolean) {
  return pending && operation?.kind === kind && operation.key === key;
}

function copyButtonLabel(status: CopyStatus) {
  if (status === "success") return "已複製";
  if (status === "error") return "複製失敗，重試";
  return "複製連結";
}

function confirmShareChange(event: { preventDefault: () => void }, message: string) {
  if (window.confirm(message)) return true;
  event.preventDefault();
  return false;
}

export function TeamLiveShareManager({ csrfToken, pages }: { csrfToken: string; pages: TeamLiveSharePage[] }) {
  const [createState, createAction, creating] = useActionState(createTeamLiveShareAction, initialTeamLiveShareActionState);
  const [disableState, disableAction, disabling] = useActionState(disableTeamLiveShareAction, initialTeamLiveShareActionState);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [pendingOperation, setPendingOperation] = useState<PendingShareOperation>(null);
  const lastShare = createState.status === "success" && createState.shareUrl ? createState : null;
  const copyStatus: CopyStatus = copyFeedback && copyFeedback.url === lastShare?.shareUrl ? copyFeedback.status : "idle";

  useEffect(() => {
    if (copyFeedback?.status !== "success") return;
    const copiedUrl = copyFeedback.url;
    const timeout = window.setTimeout(() => setCopyFeedback((current) => current?.url === copiedUrl ? null : current), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  async function copyShareUrl(url: string) {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(url);
      setCopyFeedback({ status: "success", url });
    } catch {
      setCopyFeedback({ status: "error", url });
    }
  }

  return (
    <section aria-labelledby="live-share-heading" className="mt-5 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
      <div className="flex items-start gap-3">
        <Link2 size={19} className="mt-0.5 shrink-0 text-blue-700" aria-hidden="true" />
        <div>
          <h3 id="live-share-heading" className="font-semibold text-slate-950">Live 合作分享</h3>
          <p className="mt-1 text-sm leading-5 text-slate-600">把這個 A-owned Live 分享給直接下線夥伴；對方的 click、報名與觀看會保留正確的團隊歸屬。</p>
        </div>
      </div>

      {lastShare ? (
        <div role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">{createState.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a className="min-w-0 max-w-full break-all underline" href={lastShare.shareUrl}>{lastShare.shareUrl}</a>
            <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 font-semibold" onClick={() => void copyShareUrl(lastShare.shareUrl!)}>
              {copyStatus === "success" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              {copyButtonLabel(copyStatus)}
            </button>
          </div>
          {copyStatus === "error" ? <p role="alert" aria-live="assertive" className="mt-2 text-xs font-medium text-red-700">瀏覽器無法複製分享連結，請允許剪貼簿權限後重試。</p> : null}
          <p className="mt-2 text-xs text-emerald-800">安全提醒：完整 token 只在這次畫面顯示；重新整理後只能重新產生連結。</p>
        </div>
      ) : null}

      {pages.length === 0 ? (
        <p className="mt-4 rounded-md border border-border bg-white p-3 text-sm text-slate-600">目前沒有可分享的 scheduled、live 或可回放 Live。請先把自己的夥伴頁綁定 A-owned Live。</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {pages.map((page) => (
            <div key={page.id} className="rounded-md border border-border bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">/{page.slug}</p>
                  <p className="text-xs text-slate-600">{page.headline} · {page.liveTitle} · {statusLabel(page.liveStatus)}</p>
                </div>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">A-owned</span>
              </div>
              {page.targets.length === 0 ? <p className="mt-3 text-sm text-slate-500">目前沒有可分享的直接下線夥伴。</p> : (
                <div className="mt-3 grid gap-2">
                  {page.targets.map((target) => {
                    const createMessage = actionMessage(createState, page.id, target.membershipId);
                    const disableMessage = actionMessage(disableState, page.id, target.membershipId);
                    const isFreshlyCreated = lastShare?.pageId === page.id && lastShare.promoterMembershipId === target.membershipId;
                    const operationKey = shareOperationKey(page.id, target.membershipId);
                    const creatingThisShare = operationIsPending(pendingOperation, "create", operationKey, creating);
                    const disablingThisShare = operationIsPending(pendingOperation, "disable", operationKey, disabling);
                    const anyShareOperationPending = creating || disabling;
                    return (
                      <div key={target.membershipId} className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">{target.label}</p>
                          <p className="text-xs text-slate-500">{target.email}</p>
                          {target.activeShare && !isFreshlyCreated ? <p className="mt-1 text-xs text-emerald-700">已啟用 · {formatExpiry(target.activeShare.expiresAt)}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <form action={createAction} onSubmit={(event) => {
                            if (target.activeShare && !window.confirm(`重新產生會讓 ${target.label} 的舊分享連結立即失效。確定繼續？`)) {
                              event.preventDefault();
                              return;
                            }
                            setPendingOperation({ kind: "create", key: operationKey });
                          }} aria-busy={creatingThisShare}>
                            <input type="hidden" name="_csrf" value={csrfToken} />
                            <input type="hidden" name="teamId" value={page.teamId} />
                            <input type="hidden" name="pageId" value={page.id} />
                            <input type="hidden" name="promoterMembershipId" value={target.membershipId} />
                            <button type="submit" disabled={anyShareOperationPending} aria-disabled={anyShareOperationPending} aria-busy={creatingThisShare} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                              <RotateCcw size={15} aria-hidden="true" />{creatingThisShare ? "建立中…" : target.activeShare ? "重新產生" : "建立連結"}
                            </button>
                            <span role="status" aria-live="polite" className="sr-only">{creatingThisShare ? "正在建立新的 Live 合作分享連結，請勿重複送出。" : ""}</span>
                          </form>
                          {target.activeShare ? (
                            <form action={disableAction} onSubmit={(event) => {
                              if (confirmShareChange(event, `確定要停用 ${target.label} 的 Live 合作分享連結？既有連結會立即失效。`)) {
                                setPendingOperation({ kind: "disable", key: operationKey });
                              }
                            }} aria-busy={disablingThisShare}>
                              <input type="hidden" name="_csrf" value={csrfToken} />
                              <input type="hidden" name="teamId" value={page.teamId} />
                              <input type="hidden" name="pageId" value={page.id} />
                              <input type="hidden" name="promoterMembershipId" value={target.membershipId} />
                              <button type="submit" disabled={anyShareOperationPending} aria-disabled={anyShareOperationPending} aria-busy={disablingThisShare} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                                <XCircle size={15} aria-hidden="true" />{disablingThisShare ? "停用中…" : "停用"}
                              </button>
                              <span role="status" aria-live="polite" className="sr-only">{disablingThisShare ? "正在停用 Live 合作分享連結，請勿重複送出。" : ""}</span>
                            </form>
                          ) : null}
                        </div>
                        {createMessage ? <p role={createState.status === "error" ? "alert" : "status"} aria-live={createState.status === "error" ? "assertive" : "polite"} className="text-xs text-slate-600">{createMessage}</p> : null}
                        {disableMessage ? <p role={disableState.status === "error" ? "alert" : "status"} aria-live={disableState.status === "error" ? "assertive" : "polite"} className="text-xs text-slate-600">{disableMessage}</p> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
