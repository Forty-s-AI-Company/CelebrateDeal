import Image from "next/image";
import { notFound } from "next/navigation";
import { StudentPortalLoginForm } from "@/components/student-portal-login-form";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

function safeBrandColor(value: string) {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : "#2563eb";
}

export default async function StudentPortalLoginPage({ params }: { params: Promise<{ vendorSlug: string }> }) {
  const { vendorSlug } = await params;
  const [vendor, csrfToken] = await Promise.all([
    getDb().vendor.findUnique({ where: { slug: vendorSlug }, select: { name: true, slug: true, logoUrl: true, primaryColor: true } }),
    getCsrfToken(),
  ]);
  if (!vendor) notFound();
  const accentColor = safeBrandColor(vendor.primaryColor);

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:py-16">
      <section className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_8px_8px_rgba(15,23,42,0.06)]">
        <div className="h-2" style={{ backgroundColor: accentColor }} />
        <div className="p-6 sm:p-9">
          <div className="flex items-center gap-4">
            {vendor.logoUrl ? <Image src={vendor.logoUrl} alt={`${vendor.name} Logo`} width={56} height={56} className="size-14 rounded-xl object-cover" /> : <div aria-hidden="true" className="grid size-14 place-items-center rounded-xl bg-slate-900 text-xl font-black text-white">{vendor.name.slice(0, 1)}</div>}
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-600">{vendor.name}</p><h1 className="text-2xl font-bold tracking-[-0.025em] text-slate-950 text-balance">回到你的學習中心</h1></div>
          </div>
          <p className="mt-6 text-pretty text-sm leading-6 text-slate-700">不用記密碼。輸入報名或購課時使用的 Email，我們會寄一封 15 分鐘有效的登入連結給你。</p>
          <StudentPortalLoginForm vendorSlug={vendor.slug} csrfToken={csrfToken} accentColor={accentColor} />
          <p className="mt-6 text-xs leading-5 text-slate-600">為了保護你的資料，畫面不會透露這個 Email 是否已存在。</p>
        </div>
      </section>
    </main>
  );
}
