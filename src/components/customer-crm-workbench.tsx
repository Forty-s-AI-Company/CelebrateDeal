"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { searchCustomersAction, type CustomerSearchActionState } from "@/app/actions/customer-crm-actions";
import { Badge, Card } from "@/components/ui";

function formatActivityDate(dateInput: string | Date) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function CustomerCrmWorkbench({ initialState, csrfField }: { initialState: CustomerSearchActionState; csrfField: ReactNode }) {
  const [state, action, pending] = useActionState(searchCustomersAction, initialState);
  return <Card>
    <form action={action} className="mb-5 grid gap-3 sm:grid-cols-[1fr_240px_auto]" aria-busy={pending}>
      {csrfField}
      <input aria-label="搜尋學員" name="query" maxLength={320} autoComplete="off" placeholder="搜尋姓名、Email 或電話" className="h-11 rounded-md border border-border px-3" />
      <input aria-label="標籤篩選" name="tag" maxLength={50} autoComplete="off" placeholder="標籤，例如：高意向" className="h-11 rounded-md border border-border px-3" />
      <button disabled={pending} className="h-11 rounded-md bg-primary px-5 font-semibold text-white disabled:opacity-60">{pending ? "搜尋中…" : "搜尋"}</button>
    </form>
    <p className="mb-4 text-xs text-slate-500">搜尋內容以安全表單送出，不會寫入網址或瀏覽器歷程。</p>
    {state.status === "error" ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{state.message}</p> : null}
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="border-b text-slate-500"><tr>{["學員", "聯絡資訊", "最新動態", "觀看", "預約", "標籤", "累計消費"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{state.items.map((item) => <tr key={item.customerKeyHash} className="border-b last:border-0"><td className="p-3 font-semibold"><Link className="text-primary hover:underline" href={`/customers/${encodeURIComponent(item.customerKeyHash)}`}>{item.name}</Link></td><td className="p-3 text-slate-600">{item.maskedEmail}<br />{item.maskedPhone}</td><td className="p-3" suppressHydrationWarning>{formatActivityDate(item.latestActivityAt)}</td><td className="p-3">{Math.round(item.watchSeconds / 60)} 分</td><td className="p-3">{item.bookingStatus ?? "—"}</td><td className="p-3"><div className="flex flex-wrap gap-1">{item.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div></td><td className="p-3">NT${Math.round(item.lifetimeValueCents / 100).toLocaleString("zh-TW")}</td></tr>)}</tbody></table>{!state.items.length ? <p className="py-10 text-center text-slate-500">{state.message || "目前沒有符合條件的學員。"}</p> : null}</div>
  </Card>;
}
