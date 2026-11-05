import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { switchFromSuspendedVendorAction } from "@/app/actions/vendor-suspension-actions";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { requireAuth } from "@/lib/auth";
import { isVendorBackofficeRole, signedInHomePath } from "@/lib/vendor-roles";
import { isVendorSuspended, VENDOR_SUSPENDED_PATH } from "@/lib/vendor-suspension-state";

export const metadata: Metadata = { title: "商家已暫停", robots: { index: false, follow: false } };

/**
 * F-036: the only back-office page a member of a suspended vendor can open.
 * It shows nothing of the tenant beyond its name; the internal reason stays
 * with the platform. A member of other, active vendors can move this session
 * to one of them.
 */
export default async function VendorSuspendedPage() {
  const auth = await requireAuth({ nextPath: VENDOR_SUSPENDED_PATH });
  if (!auth.suspendedVendor) redirect(signedInHomePath(auth));
  const otherVendors = auth.user.memberships
    .filter((membership) => membership.status === "active" && isVendorBackofficeRole(membership.role)
      && membership.vendorId !== auth.suspendedVendor?.id && !isVendorSuspended(membership.vendor))
    .map((membership) => ({ id: membership.vendor.id, name: membership.vendor.name }));

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-950">商家已暫停</h1>
      <p role="alert" className="mt-4 text-base leading-7 text-slate-700">
        「{auth.suspendedVendor.name}」已由平台暫停服務。暫停期間無法使用後台功能，公開頁面也不會對外顯示；已完成的付款紀錄仍會保留。
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-600">如需了解原因或申請恢復，請聯絡 CelebrateDeal 平台客服。</p>
      {otherVendors.length > 0 ? (
        <section aria-labelledby="switch-vendor-heading" className="mt-8">
          <h2 id="switch-vendor-heading" className="text-base font-semibold text-slate-900">切換商家</h2>
          <p className="mt-1 text-sm text-slate-600">你也是以下商家的成員，可以切換過去繼續使用後台。</p>
          <ul className="mt-3 grid gap-2">
            {otherVendors.map((vendor) => (
              <li key={vendor.id}>
                <form action={switchFromSuspendedVendorAction} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <CsrfField />
                  <input type="hidden" name="vendorId" value={vendor.id} />
                  <span className="text-sm font-medium text-slate-800">{vendor.name}</span>
                  <FormSubmitButton
                    pendingChildren="切換中…"
                    pendingMessage="正在切換商家，請勿重複送出。"
                    className="min-h-11 rounded-md border border-border px-4 text-sm font-semibold text-slate-700"
                  >
                    切換到此商家
                  </FormSubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        {auth.isPlatformAdmin ? (
          <Link href="/admin/vendor-features" className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700">
            前往平台管理
          </Link>
        ) : null}
        <form action={logoutAction}>
          <CsrfField />
          <FormSubmitButton
            pendingChildren="登出中…"
            pendingMessage="正在結束目前登入並登出，請勿重複送出。"
            className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            登出
          </FormSubmitButton>
        </form>
      </div>
    </main>
  );
}
