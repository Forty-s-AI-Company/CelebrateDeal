import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

const triggerLabels: Record<string, string> = {
  registration_confirmed: "報名成功",
  live_reminder: "開播提醒",
  post_live_followup: "課後通知",
};

function triggerLabel(value: string) {
  return triggerLabels[value] ?? "未知觸發條件";
}

function channelLabel(value: string) {
  return value === "email" ? "Email" : value;
}

export default async function MessageTemplatePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const template = await getDb().messageTemplate.findFirst({
    where: { id, vendorId: vendor.id },
    select: {
      id: true,
      name: true,
      channel: true,
      trigger: true,
      subject: true,
      body: true,
      isActive: true,
    },
  });
  if (!template) notFound();

  return (
    <>
      <PageHeader
        title="訊息模板預覽"
        description="這是靜態內容預覽；變數不會展開，也不會寄送 Email。"
        action={<ButtonLink href={`/messages/templates/${encodeURIComponent(template.id)}/edit`} tone="secondary">返回編輯</ButtonLink>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card>
          <div className="border-b border-border pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email 主旨</p>
            <p className="mt-2 break-words text-lg font-semibold text-slate-950">{template.subject?.trim() || "未設定主旨"}</p>
          </div>
          <div className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email 內容</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{template.body}</p>
          </div>
          <p role="note" className="mt-6 rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            這是靜態內容預覽，變數不會展開，也不會寄送 Email。
          </p>
        </Card>
        <Card className="h-fit">
          <h2 className="text-lg font-semibold text-slate-950">模板資訊</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex items-start justify-between gap-4"><dt className="text-slate-500">模板名稱</dt><dd className="max-w-[12rem] break-words text-right font-semibold text-slate-900">{template.name}</dd></div>
            <div className="flex items-center justify-between gap-4"><dt className="text-slate-500">渠道</dt><dd className="font-semibold text-slate-900">{channelLabel(template.channel)}</dd></div>
            <div className="flex items-center justify-between gap-4"><dt className="text-slate-500">觸發條件</dt><dd className="font-semibold text-slate-900">{triggerLabel(template.trigger)}</dd></div>
            <div className="flex items-center justify-between gap-4"><dt className="text-slate-500">狀態</dt><dd><Badge tone={template.isActive ? "green" : "gray"}>{template.isActive ? "啟用" : "停用"}</Badge></dd></div>
          </dl>
        </Card>
      </div>
    </>
  );
}
