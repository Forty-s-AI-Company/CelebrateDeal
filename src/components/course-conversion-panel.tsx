"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, ShoppingBag } from "lucide-react";
import { safeCommerceUrlOrNull } from "@/lib/safe-commerce-url";

const clientHeaders = { "Content-Type": "application/json", "X-CelebrateDeal-Client": "web" };

type Session = { id: string; title: string; startsAt: string; capacity: number | null };
type Product = { id: string; name: string; priceCents: number; currency: string; imageUrl: string | null };

function visitorId() {
  const key = "celebrate_visitor_id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  window.localStorage.setItem(key, created);
  return created;
}

function submitCheckout(checkout: { checkoutMode?: string; redirectUrl?: string; checkoutUrl?: string; formAction?: string; formMethod?: string; formPayload?: Record<string, string> }) {
  const redirectUrl = safeCommerceUrlOrNull(checkout.redirectUrl ?? checkout.checkoutUrl);
  if (redirectUrl) {
    window.location.assign(redirectUrl);
    return true;
  }
  const formAction = safeCommerceUrlOrNull(checkout.formAction);
  if (!formAction || !checkout.formPayload) return false;
  const form = document.createElement("form");
  form.method = checkout.formMethod ?? "POST";
  form.action = formAction;
  for (const [name, value] of Object.entries(checkout.formPayload)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  return true;
}

export function CourseConversionPanel({
  courseId,
  courseSlug,
  vendorId,
  sessions,
  product,
  submitLabel,
  successMessage,
}: {
  courseId: string;
  courseSlug: string;
  vendorId: string;
  sessions: Session[];
  product: Product | null;
  submitLabel: string;
  successMessage: string;
}) {
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const id = useMemo(() => typeof window === "undefined" ? "server" : visitorId(), []);

  useEffect(() => {
    void fetch("/api/analytics", { method: "POST", headers: clientHeaders, body: JSON.stringify({ vendorId, visitorId: id, eventType: "course_view", payload: { courseId, slug: courseSlug } }) });
    const referralCode = new URLSearchParams(window.location.search).get("ref");
    if (referralCode) {
      void fetch("/api/affiliate-clicks", { method: "POST", headers: clientHeaders, body: JSON.stringify({ vendorId, referralCode, visitorId: id, landingPath: `${window.location.pathname}${window.location.search}` }) });
    }
  }, [courseId, courseSlug, id, vendorId]);

  async function enroll(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/course-enrollments", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({
        courseId,
        sessionId: String(form.get("sessionId") ?? "") || null,
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        phone: String(form.get("phone") ?? "") || null,
      }),
    });
    setState(response.ok ? "success" : "error");
  }

  async function checkout() {
    if (!product || checkoutBusy) return;
    setCheckoutBusy(true);
    void fetch("/api/analytics", { method: "POST", headers: clientHeaders, body: JSON.stringify({ vendorId, visitorId: id, eventType: "course_product_click", payload: { courseId, productId: product.id } }) });
    const response = await fetch("/api/payments/checkout", { method: "POST", headers: clientHeaders, body: JSON.stringify({ vendorId, productId: product.id }) });
    if (!response.ok || !submitCheckout(await response.json())) setCheckoutBusy(false);
  }

  if (state === "success") {
    return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><CheckCircle2 className="mb-3" size={28} /><p className="font-semibold">{successMessage}</p><p className="mt-1 text-sm">若有啟用通知模板，確認信已排入投遞佇列。</p></div>;
  }

  return (
    <div className="grid gap-5">
      <form onSubmit={enroll} className="grid gap-4">
        <div><h2 className="text-xl font-semibold text-slate-950">立即報名</h2><p className="mt-1 text-sm text-slate-500">完成報名不代表付款，購買商品請使用下方獨立 CTA。</p></div>
        {sessions.length > 0 ? <label className="grid gap-1.5 text-sm font-medium text-slate-700"><span className="flex items-center gap-2"><CalendarDays size={15} />選擇場次</span><select name="sessionId" className="h-11 rounded-md border border-slate-200 bg-white px-3"><option value="">不指定場次</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.title} · {new Date(session.startsAt).toLocaleString("zh-TW")}</option>)}</select></label> : null}
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">姓名<input name="name" required maxLength={120} className="h-11 rounded-md border border-slate-200 px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">Email<input name="email" type="email" required maxLength={320} className="h-11 rounded-md border border-slate-200 px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">手機（選填）<input name="phone" type="tel" maxLength={40} className="h-11 rounded-md border border-slate-200 px-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label>
        {state === "error" ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">報名未完成，請確認場次容量與資料後再試。</p> : null}
        <button disabled={state === "submitting"} className="h-11 rounded-md bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{state === "submitting" ? "送出中..." : submitLabel}</button>
      </form>
      {product ? <div className="border-t border-slate-200 pt-5"><div className="flex items-center justify-between gap-4"><div><p className="text-sm text-slate-500">主要商品</p><p className="font-semibold text-slate-950">{product.name}</p><p className="mt-1 text-lg font-bold text-orange-600">{new Intl.NumberFormat("zh-TW", { style: "currency", currency: product.currency, maximumFractionDigits: product.currency === "TWD" ? 0 : 2 }).format(product.priceCents / 100)}</p></div><button type="button" onClick={checkout} disabled={checkoutBusy} className="inline-flex h-11 items-center gap-2 rounded-md bg-orange-500 px-5 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"><ShoppingBag size={17} />{checkoutBusy ? "處理中..." : "前往購買"}</button></div></div> : null}
    </div>
  );
}
