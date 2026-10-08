import { portalText } from "@/lib/student-portal-translations";
import { resolveStudentPortalLocale } from "@/lib/student-portal-locale";
import Image from "next/image";
import { notFound } from "next/navigation";
import { StudentPortalLoginForm } from "@/components/student-portal-login-form";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
function safeBrandColor(value: string) {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : "#2563eb";
}
export default async function StudentPortalLoginPage({
  params,searchParams
}: {
  searchParams?:Promise<{error?:string|string[]}>;
  params: Promise<{
    vendorSlug: string;
  }>;
}) {
  const locale = await resolveStudentPortalLocale();
  const t = (text: string) => portalText(locale, text);
  const {
    vendorSlug
  } = await params;
  const [vendor, csrfToken] = await Promise.all([getDb().vendor.findUnique({
    where: {
      slug: vendorSlug
    },
    select: {
      name: true,
      slug: true,
      logoUrl: true,
      primaryColor: true
    }
  }), getCsrfToken()]);
  if (!vendor) notFound();
  const accentColor = safeBrandColor(vendor.primaryColor);
  const query=searchParams?await searchParams:{};
  return <main className="min-h-screen bg-slate-100 px-4 py-10 sm:py-16">
      <section className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_8px_8px_rgba(15,23,42,0.06)]">
        <div className="h-2" style={{
        backgroundColor: accentColor
      }} />
        <div className="p-6 sm:p-9">
          <div className="flex items-center gap-4">
            {vendor.logoUrl ? <Image src={vendor.logoUrl} alt={`${vendor.name} Logo`} width={56} height={56} className="size-14 rounded-xl object-cover" /> : <div aria-hidden="true" className="grid size-14 place-items-center rounded-xl bg-slate-900 text-xl font-black text-white">{vendor.name.slice(0, 1)}</div>}
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-600">{vendor.name}</p><h1 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 text-balance">{t("\u56DE\u5230\u4F60\u7684\u5B78\u7FD2\u4E2D\u5FC3")}</h1></div>
          </div>
          <p className="mt-6 text-pretty text-sm leading-6 text-slate-700">{t("\u4E0D\u7528\u8A18\u5BC6\u78BC\u3002\u8F38\u5165\u5831\u540D\u6216\u8CFC\u8AB2\u6642\u4F7F\u7528\u7684 Email\uFF0C\u6211\u5011\u6703\u5BC4\u4E00\u5C01 15 \u5206\u9418\u6709\u6548\u7684\u767B\u5165\u9023\u7D50\u7D66\u4F60\u3002")}</p>
          {typeof query.error==="string"?<p role="alert">{t("登入連結無效或已過期，請重新申請。")}</p>:null}<StudentPortalLoginForm locale={locale} vendorSlug={vendor.slug} csrfToken={csrfToken} accentColor={accentColor} />
          <p className="mt-6 text-xs leading-5 text-slate-600">{t("\u70BA\u4E86\u4FDD\u8B77\u4F60\u7684\u8CC7\u6599\uFF0C\u756B\u9762\u4E0D\u6703\u900F\u9732\u9019\u500B Email \u662F\u5426\u5DF2\u5B58\u5728\u3002")}</p>
        </div>
      </section>
    </main>;
}
