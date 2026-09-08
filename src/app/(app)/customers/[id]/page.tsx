import { notFound } from "next/navigation";
import { addCustomerTagAction, grantCustomerVoucherAction, removeCustomerTagAction, saveConsultantNoteAction, updateCustomerStatusAction } from "@/app/actions/customer-crm-actions";
import { CsrfField } from "@/components/csrf-field";
import { CustomerCopyButton } from "@/components/customer-copy-button";
import { Badge, Card, PageHeader, SubmitButton, TextArea } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCustomerProfile } from "@/lib/customer-crm";
import { getDb } from "@/lib/db";

const STATUS_LABELS: Record<string, string> = { following_up: "跟進中", closed_won: "已成交", closed_lost: "無意願", no_show: "未出席" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [vendor, { id }] = await Promise.all([requireVendorManager(), params]);
  const profile = await getCustomerProfile(vendor.id, id);
  if (!profile) notFound();
  const products = await getDb().product.findMany({ where: { vendorId: vendor.id, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 100 });
  const summary = [`學員：${profile.name}`, `聯絡：${profile.maskedEmail} / ${profile.maskedPhone}`, `累計消費：NT$${Math.round(profile.lifetimeValueCents / 100).toLocaleString("zh-TW")}`, `觀看：${Math.round(profile.watchSeconds / 60)} 分鐘`, `諮詢問卷：${profile.bookingAnswers ? JSON.stringify(profile.bookingAnswers) : "未填寫"}`].join("\n");
  return <div className="space-y-6">
    <PageHeader title={`${profile.name} 的 360° 旅程`} description={`${profile.maskedEmail} · ${profile.maskedPhone}`} action={<CustomerCopyButton summary={summary} />} />
    <div className="grid gap-4 sm:grid-cols-4"><Card><p className="text-sm text-slate-500">LTV</p><p className="mt-2 text-2xl font-semibold">NT${Math.round(profile.lifetimeValueCents / 100).toLocaleString("zh-TW")}</p></Card><Card><p className="text-sm text-slate-500">累計觀看</p><p className="mt-2 text-2xl font-semibold">{Math.round(profile.watchSeconds / 60)} 分鐘</p><p className="mt-1 text-xs text-slate-500">{profile.entryCount} 次進場</p></Card><Card><p className="text-sm text-slate-500">觀看完成率</p><p className="mt-2 text-2xl font-semibold">{profile.watchCompletionRate === null ? "—" : `${profile.watchCompletionRate}%`}</p></Card><Card><p className="text-sm text-slate-500">成交狀態</p><p className="mt-2 text-2xl font-semibold">{STATUS_LABELS[profile.consultationStatus]}</p></Card></div>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,1fr)]">
      <Card><h2 className="text-lg font-semibold">全鏈路意向時間軸</h2><ol className="mt-5 space-y-0">{profile.timeline.map((event) => <li key={event.id} className="relative border-l-2 border-blue-100 pb-6 pl-6 last:pb-0"><span className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-primary" /><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{event.title}</p><time className="text-xs text-slate-500">{event.occurredAt.toLocaleString("zh-TW")}</time></div>{event.detail ? <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{event.detail}</p> : null}</li>)}</ol>{!profile.timeline.length ? <p className="mt-5 text-slate-500">尚無旅程事件。</p> : null}</Card>
      <div className="space-y-5"><Card><h2 className="text-lg font-semibold">顧問會談</h2><form action={saveConsultantNoteAction} className="mt-4 space-y-4"><CsrfField /><input type="hidden" name="customerKeyHash" value={id} /><label className="grid gap-1 text-sm font-medium">諮詢結果<select name="status" defaultValue={profile.consultationStatus} className="h-11 rounded-md border border-border px-3">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><TextArea label="顧問備註" name="body" required maxLength={4000} placeholder="記錄痛點、異議與下一步…" /><SubmitButton>儲存會談紀錄</SubmitButton></form><form action={updateCustomerStatusAction} className="mt-4 flex gap-2"><CsrfField /><input type="hidden" name="customerKeyHash" value={id} /><input type="hidden" name="status" value="closed_won" /><SubmitButton>快速標記已成交</SubmitButton></form></Card>
      <Card><h2 className="text-lg font-semibold">標籤</h2><div className="mt-3 flex flex-wrap gap-2">{profile.tags?.map((item) => <form action={removeCustomerTagAction} key={item.id}><CsrfField /><input type="hidden" name="customerKeyHash" value={id} /><input type="hidden" name="tag" value={item.tag} /><button title="移除標籤"><Badge>{item.tag} ×</Badge></button></form>)}</div><form action={addCustomerTagAction} className="mt-4 flex gap-2"><CsrfField /><input type="hidden" name="customerKeyHash" value={id} /><input name="tag" required maxLength={50} placeholder="新增標籤" className="h-11 min-w-0 flex-1 rounded-md border border-border px-3" /><SubmitButton>新增</SubmitButton></form></Card>
      <Card><h2 className="text-lg font-semibold">限時專屬優惠</h2><form action={grantCustomerVoucherAction} className="mt-4 space-y-3"><CsrfField /><input type="hidden" name="customerKeyHash" value={id} /><select name="productId" required className="h-11 w-full rounded-md border border-border px-3"><option value="">選擇商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select><p className="text-xs text-slate-500">派發 72 小時有效的九折券。</p><SubmitButton disabled={!products.length}>補發專屬優惠券</SubmitButton></form></Card></div>
    </div>
  </div>;
}
