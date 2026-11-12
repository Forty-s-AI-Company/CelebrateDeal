import Link from "next/link";
import { Plus } from "lucide-react";
import {
  activateEmailSequenceAction,
  deleteEmailSequenceAction,
  pauseEmailSequenceAction,
} from "@/app/actions/email-sequence-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  describeDelay,
  EMAIL_SEQUENCE_STATUS_LABELS,
  ID_PATTERN,
  MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR,
  type EmailSequenceStatus,
} from "@/lib/email-sequence-rules";
import { emailSequenceRunCounts } from "@/lib/email-sequences";
import { requireFeatureOrNotFound } from "@/lib/feature-gates";

const NOTICES: Record<string, string> = {
  created: "序列已建立。確認內容後按「啟用」才會開始寄。",
  saved: "序列已儲存。",
  activated: "序列已啟用。從現在起完成 Email 驗證的報名者會依序收到信。",
  paused: "序列已暫停。進行中的人已停止收信，重新啟用後也不會補寄。",
  deleted: "序列已刪除。",
};

const ERRORS: Record<string, string> = {
  not_found: "找不到這條序列，可能已被刪除。",
  conflict: "這條序列剛在其他分頁被修改過，請確認目前內容後再操作一次。",
  active_limit: `每個商家最多 ${MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR} 條寄送中的序列，請先暫停其中一條再啟用。`,
  not_ready: "還不能啟用：序列至少要有一封要寄的信，而且每封要寄的信模板都要是啟用中、內容完整的「追銷序列信」。",
};

const STATUS_TONES: Record<EmailSequenceStatus, "green" | "gray" | "orange"> = {
  active: "green",
  draft: "gray",
  paused: "orange",
};

const secondaryButton = "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function SequenceActionForm({
  action,
  sequenceId,
  version,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  sequenceId: string;
  version: number;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <CsrfField />
      <input type="hidden" name="sequenceId" value={sequenceId} />
      <input type="hidden" name="expectedVersion" value={version} />
      {children}
    </form>
  );
}

export default async function EmailSequencesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[]; error?: string | string[]; liveId?: string | string[] }>;
}) {
  const vendor = await requireVendorManager();
  requireFeatureOrNotFound(vendor, "email_sequences");
  const query = await searchParams;
  const notice = NOTICES[single(query.notice) ?? ""];
  const error = ERRORS[single(query.error) ?? ""];
  const liveFilter = single(query.liveId);
  const liveId = liveFilter && ID_PATTERN.test(liveFilter) ? liveFilter : null;
  const db = getDb();
  const [sequences, counts, filterLive, activeCount] = await Promise.all([
    db.emailSequence.findMany({
      where: { vendorId: vendor.id, ...(liveId ? { liveId } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        status: true,
        version: true,
        live: { select: { id: true, title: true } },
        steps: { orderBy: { delayMinutes: "asc" }, select: { delayMinutes: true, isActive: true } },
      },
    }),
    emailSequenceRunCounts(vendor.id),
    liveId ? db.live.findFirst({ where: { id: liveId, vendorId: vendor.id }, select: { id: true, title: true } }) : null,
    db.emailSequence.count({ where: { vendorId: vendor.id, status: "active" } }),
  ]);
  const newHref = filterLive ? `/messages/sequences/new?liveId=${encodeURIComponent(filterLive.id)}` : "/messages/sequences/new";

  return (
    <>
      <PageHeader
        title="追銷序列"
        description="報名者完成 Email 驗證後，依你排好的時間一封一封寄出。序列只寄給啟用之後才驗證的人，每封都會附退訂連結。"
        action={(
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/messages/templates" tone="secondary">訊息模板</ButtonLink>
            <ButtonLink href={newHref}><Plus size={16} aria-hidden="true" />新增序列</ButtonLink>
          </div>
        )}
      />
      {notice ? <p role="status" aria-live="polite" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
      {filterLive ? (
        <p className="mb-4 text-sm text-slate-600">
          只顯示「{filterLive.title}」的序列。<Link href="/messages/sequences" className="font-semibold text-primary underline underline-offset-2">顯示全部</Link>
        </p>
      ) : null}
      <p className="mb-4 text-sm text-slate-600">寄送中 {activeCount}／{MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR} 條。寄送時間依排程每隔一段時間檢查一次，實際寄出可能比設定晚一點。</p>
      {sequences.length === 0 ? (
        <EmptyState
          title={filterLive ? "這場直播還沒有追銷序列" : "還沒有追銷序列"}
          description="先準備好「追銷序列信」模板，再建立序列、排好每一封的寄送時間。"
          action={<ButtonLink href={newHref}>新增序列</ButtonLink>}
        />
      ) : (
        <Card>
          <ul className="grid gap-3">
            {sequences.map((sequence) => {
              const status = (sequence.status in EMAIL_SEQUENCE_STATUS_LABELS ? sequence.status : "draft") as EmailSequenceStatus;
              const runCounts = counts.get(sequence.id) ?? { active: 0, completed: 0, cancelled: 0 };
              const activeSteps = sequence.steps.filter((step) => step.isActive);
              return (
                <li key={sequence.id} className="grid gap-3 rounded-lg border border-border p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{sequence.name}</h2>
                      <p className="mt-1 text-sm text-slate-600 [overflow-wrap:anywhere]">直播：{sequence.live.title}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {activeSteps.length > 0
                          ? `${activeSteps.length} 封：${activeSteps.map((step) => describeDelay(step.delayMinutes)).join("、")}`
                          : "還沒有要寄的信"}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONES[status]}>{EMAIL_SEQUENCE_STATUS_LABELS[status]}</Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-md bg-slate-50 px-3 py-2"><dt className="text-slate-600">進行中</dt><dd className="font-semibold text-slate-950">{runCounts.active} 人</dd></div>
                    <div className="rounded-md bg-slate-50 px-3 py-2"><dt className="text-slate-600">已完成</dt><dd className="font-semibold text-slate-950">{runCounts.completed} 人</dd></div>
                    <div className="rounded-md bg-slate-50 px-3 py-2"><dt className="text-slate-600">已停止</dt><dd className="font-semibold text-slate-950">{runCounts.cancelled} 人</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/messages/sequences/${encodeURIComponent(sequence.id)}/edit`} className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary-dark">
                      編輯
                    </Link>
                    {status === "active" ? (
                      <SequenceActionForm action={pauseEmailSequenceAction} sequenceId={sequence.id} version={sequence.version}>
                        <FormSubmitButton
                          pendingChildren="暫停中…"
                          pendingMessage="正在暫停序列。"
                          confirmMessage={`暫停後，進行中的 ${runCounts.active} 人會停止收信，重新啟用也不會補寄。確定暫停「${sequence.name}」？`}
                          className={secondaryButton}
                        >
                          暫停
                        </FormSubmitButton>
                      </SequenceActionForm>
                    ) : (
                      <SequenceActionForm action={activateEmailSequenceAction} sequenceId={sequence.id} version={sequence.version}>
                        <FormSubmitButton pendingChildren="啟用中…" pendingMessage="正在啟用序列。" className={secondaryButton}>
                          啟用
                        </FormSubmitButton>
                      </SequenceActionForm>
                    )}
                    <SequenceActionForm action={deleteEmailSequenceAction} sequenceId={sequence.id} version={sequence.version}>
                      <FormSubmitButton
                        pendingChildren="刪除中…"
                        pendingMessage="正在刪除序列。"
                        confirmDestructive
                        confirmMessage={`刪除「${sequence.name}」後，序列和每個人的進度都會移除，還沒寄出的信也不會再寄。確定刪除？`}
                        className="inline-flex min-h-11 items-center justify-center rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50"
                      >
                        刪除
                      </FormSubmitButton>
                    </SequenceActionForm>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
