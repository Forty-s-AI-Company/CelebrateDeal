import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/actions/auth-security-actions";
import { acceptBetaAgreementAction } from "@/app/actions/beta-agreement-actions";
import { BetaAgreementDialog } from "@/components/beta-agreement-dialog";
import { BetaAgreementText } from "@/components/beta-agreement-text";
import { CsrfField } from "@/components/csrf-field";
import { FormSubmitButton } from "@/components/form-submit-button";
import { requireAuth } from "@/lib/auth";
import {
  BETA_AGREEMENT_PATH,
  betaAgreementPending,
  betaAgreementReturnPath,
  canAcceptBetaAgreement,
} from "@/lib/beta-agreement";
import { betaAgreement } from "@/lib/beta-agreement-content";
import { isVendorBackofficeRole, signedInHomePath } from "@/lib/vendor-roles";
import { VENDOR_SUSPENDED_PATH } from "@/lib/vendor-suspension-state";

export const metadata: Metadata = { title: "封測合作協議", robots: { index: false, follow: false } };

const ERROR_MESSAGES: Record<string, string> = {
  consent_required: "請勾選同意後再送出。",
  agreement_updated: "協議已更新為新版本，請重新閱讀後再同意。",
  owner_required: "只有商家 owner 可以代表商家同意本協議。",
  vendor_changed: "目前登入的商家已變更，請確認下方乙方資料後再同意。",
  temporarily_unavailable: "暫時無法記錄你的同意，請稍後再試。",
};

/**
 * O-11 gate: the only back-office page a vendor without an acceptance of the
 * current 封測合作協議 can open (`requireVendorContext` sends every other one
 * here). Owners read and accept; other roles wait for an owner.
 */
export default async function BetaAgreementGatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const auth = await requireAuth({ nextPath: BETA_AGREEMENT_PATH });
  if (auth.suspendedVendor) redirect(VENDOR_SUSPENDED_PATH);
  if (!auth.vendor || !auth.member || !isVendorBackofficeRole(auth.member.role)) redirect(signedInHomePath(auth));
  const nextParam = typeof query.next === "string" ? query.next : null;
  const next = betaAgreementReturnPath(nextParam);
  if (!await betaAgreementPending(auth, auth.vendor.id)) redirect(next);

  const errorCode = typeof query.error === "string" ? query.error : null;
  const error = errorCode ? ERROR_MESSAGES[errorCode] ?? null : null;
  const logout = (
    <form action={logoutAction}>
      <CsrfField />
      <FormSubmitButton
        pendingChildren="登出中…"
        pendingMessage="正在結束目前登入並登出，請勿重複送出。"
        className="inline-flex min-h-11 items-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
      >
        登出
      </FormSubmitButton>
    </form>
  );
  const publicCopy = <Link href="/policies/beta-agreement" target="_blank" rel="noopener" className="font-semibold text-primary underline">在新分頁開啟公開版本</Link>;

  if (!canAcceptBetaAgreement(auth.member)) {
    return (
      <main className="min-h-screen bg-background">
        <BetaAgreementDialog
          mode="waiting"
          title="等待商家 owner 同意封測合作協議"
          intro={<p>「{auth.vendor.name}」的 owner 尚未同意《{betaAgreement.title}》（版本 {betaAgreement.version}）。owner 登入後台並同意後，你就可以繼續使用後台。協議全文如下，也可以{publicCopy}。</p>}
          error={error}
          footer={logout}
        >
          <BetaAgreementText party={{ vendorName: auth.vendor.name, accountEmail: null }} />
        </BetaAgreementDialog>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <BetaAgreementDialog
        mode="accept"
        title={betaAgreement.title}
        intro={<p>使用後台前，請代表「{auth.vendor.name}」閱讀並同意本協議。捲動到最後即可勾選同意；之後也可以隨時查看{publicCopy}。</p>}
        error={error}
        footer={logout}
        action={acceptBetaAgreementAction}
        csrfField={<CsrfField />}
        vendorId={auth.vendor.id}
        agreementVersion={betaAgreement.version}
        next={next === "/dashboard" ? null : next}
      >
        <BetaAgreementText party={{ vendorName: auth.vendor.name, accountEmail: auth.user.email }} />
      </BetaAgreementDialog>
    </main>
  );
}
