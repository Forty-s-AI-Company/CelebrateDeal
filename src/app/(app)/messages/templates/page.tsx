import Link from "next/link";
import { Plus } from "lucide-react";
import { MESSAGE_TEMPLATE_TRIGGERS } from "@/lib/message-template";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

type MessageTemplateTrigger = (typeof MESSAGE_TEMPLATE_TRIGGERS)[number];
type MessageTemplateStatus = "active" | "inactive";

const triggerLabels: Record<MessageTemplateTrigger, string> = {
  registration_confirmed: "報名成功",
  live_reminder: "開播提醒",
  live_started: "開播即時通知",
  order_created: "訂單成立",
  order_paid: "付款成功",
  commission_credited: "佣金入帳",
  post_live_followup: "課後通知",
};

function singleSearchParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function normalizeQuery(value: string | string[] | undefined) {
  return singleSearchParam(value)?.trim().slice(0, 120) ?? "";
}

function normalizeTrigger(value: string | string[] | undefined): MessageTemplateTrigger | null {
  const candidate = singleSearchParam(value);
  return MESSAGE_TEMPLATE_TRIGGERS.includes(candidate as MessageTemplateTrigger)
    ? candidate as MessageTemplateTrigger
    : null;
}

function normalizeStatus(value: string | string[] | undefined): MessageTemplateStatus | null {
  const candidate = singleSearchParam(value);
  return candidate === "active" || candidate === "inactive" ? candidate : null;
}

function triggerLabel(value: string) {
  return triggerLabels[value as MessageTemplateTrigger] ?? "未知觸發條件";
}

function channelLabel(value: string) {
  if (value === "email") return "Email";
  if (value === "line") return "LINE";
  return value;
}

export default async function MessageTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    notice?: string;
    q?: string | string[];
    trigger?: string | string[];
    status?: string | string[];
  }>;
}) {
  const vendor = await requireVendorManager();
  const query = await searchParams;
  const search = normalizeQuery(query.q);
  const trigger = normalizeTrigger(query.trigger);
  const status = normalizeStatus(query.status);
  const hasFilters = Boolean(search || trigger || status);
  const templates = await getDb().messageTemplate.findMany({
    where: {
      vendorId: vendor.id,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { subject: { contains: search, mode: "insensitive" } },
              { body: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(trigger ? { trigger } : {}),
      ...(status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      channel: true,
      trigger: true,
      isActive: true,
    },
  });

  return (
    <>
      <PageHeader
        title="訊息模板"
        description="管理報名成功、開播提醒與課後通知 Email；購買追蹤、SMS、LINE 在事件來源或 provider 接通前保持停用。"
        action={(
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/messages/deliveries" tone="secondary">查看寄送紀錄</ButtonLink>
            <ButtonLink href="/messages/templates/new"><Plus size={16} />新增模板</ButtonLink>
          </div>
        )}
      />
      {query.notice === "reminders_reconciling" ? (
        <p role="status" aria-live="polite" className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          模板已儲存。使用這份模板的直播提醒正在分批更新，舊的未寄送版本會保留為已被取代。
        </p>
      ) : null}
      <Card className="mb-5">
        <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px_auto_auto] md:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            搜尋模板
            <input
              name="q"
              defaultValue={search}
              maxLength={120}
              placeholder="搜尋名稱、主旨或內容"
              className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            觸發條件
            <select
              name="trigger"
              defaultValue={trigger ?? ""}
              className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
            >
              <option value="">全部觸發條件</option>
              {MESSAGE_TEMPLATE_TRIGGERS.map((value) => <option key={value} value={value}>{triggerLabels[value]}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            啟用狀態
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
            >
              <option value="">全部狀態</option>
              <option value="active">啟用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark">搜尋</button>
          {hasFilters ? <Link href="/messages/templates" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">清除篩選</Link> : null}
        </form>
      </Card>
      {templates.length === 0 ? (
        <EmptyState
          title={hasFilters ? "找不到符合條件的訊息模板" : "還沒有訊息模板"}
          description={hasFilters ? "請調整搜尋文字或篩選條件後再試。" : "先建立報名成功、開播提醒或課後通知 Email；其餘渠道會在事件來源或 provider 完成後才開放。"}
          action={hasFilters ? <Link href="/messages/templates" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700">清除篩選</Link> : <ButtonLink href="/messages/templates/new">新增模板</ButtonLink>}
        />
      ) : (
        <Card>
          <div className="grid gap-3">
            {templates.map((template) => (
              <article key={template.id} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-950 [overflow-wrap:anywhere]">{template.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">{triggerLabel(template.trigger)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Badge tone="blue">{channelLabel(template.channel)}</Badge>
                  <Badge tone={template.isActive ? "green" : "gray"}>{template.isActive ? "啟用" : "停用"}</Badge>
                  <Link href={`/messages/templates/${encodeURIComponent(template.id)}/edit`} className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-white transition hover:bg-primary-dark">編輯</Link>
                  <Link href={`/messages/templates/${encodeURIComponent(template.id)}/preview`} className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">預覽內容</Link>
                </div>
              </article>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
