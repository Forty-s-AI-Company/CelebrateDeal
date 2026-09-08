import { LeadForm } from "@/components/lead-form";
import type { PublicRegistrationForm } from "@/lib/public-registration-form";
import type { LeadFormBlock as LeadFormBlockType } from "@/lib/funnel-blocks-schema";

export function LeadFormBlock({ settings, form, themeColor }: { settings: LeadFormBlockType["settings"]; form: PublicRegistrationForm; themeColor: string }) {
  const requested = new Set<string>(settings.fieldKeys);
  const fields = form.fields?.filter((field) => requested.has(field.key)) ?? null;
  return <section className={`mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 ${settings.variant === "floating" ? "sticky bottom-4 z-20" : ""}`}><div className="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur sm:p-8">{settings.title ? <h2 className="text-2xl font-black text-slate-950">{settings.title}</h2> : null}{settings.description ? <p className="mt-2 mb-6 text-sm leading-6 text-slate-600">{settings.description}</p> : null}{fields && fields.length > 0 ? <LeadForm formId={form.id} fields={fields} sessions={form.sessions} submitLabel={settings.submitLabel ?? form.submitLabel} successMessage={form.successMessage} redirectTo={`/form/${form.slug}`} themeColor={themeColor} /> : <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">表單欄位設定需要重新確認，目前暫停接收資料。</p>}</div></section>;
}
