"use client";

import { useActionState, type ReactNode } from "react";
import { startPaymentMethodSetupStateAction } from "@/app/actions/payment-method-actions";
import { FormSubmitButton } from "@/components/form-submit-button";

type Props = {
  scopeType: "VENDOR" | "MEMBERSHIP";
  providerId: string;
  liveProbeAvailable?: boolean;
  teamId?: string;
  membershipId?: string;
  csrfField: ReactNode;
};

/** The returned provider form exists only in this browser handoff, never in a URL or database. */
export function PaymentMethodSetupStartForm({ scopeType, providerId, liveProbeAvailable = false, teamId, membershipId, csrfField }: Props) {
  const [handoff, action] = useActionState(startPaymentMethodSetupStateAction, null);
  const isVendor = scopeType === "VENDOR";

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        {csrfField}
        <input type="hidden" name="scopeType" value={scopeType} />
        {teamId ? <input type="hidden" name="teamId" value={teamId} /> : null}
        {membershipId ? <input type="hidden" name="membershipId" value={membershipId} /> : null}
        <label className="flex max-w-md gap-2 text-sm text-slate-700">
          <input type="checkbox" name="setupConsent" value="yes" required className="mt-1" />
          <span>{isVendor
            ? "我同意將此付款方式綁定到目前商店，供後續經授權的方案與用量扣款使用。"
            : "我同意僅為此成員綁定付款方式，供後續經授權的扣款使用。"}
            {providerId === "payuni" ? "PAYUNi 首次設定會發起 1 元交易。" : "首次設定可能需要在金流頁完成交易。"}</span>
        </label>
        {liveProbeAvailable ? (
          <label className="flex max-w-md gap-2 text-sm text-slate-700">
            <input type="checkbox" name="oneTimeProbeConsent" value="yes" required className="mt-1" />
            <span>我另行同意這次正式 PAYUNi 驗證：完成首次 1 元綁卡交易後，約 10 分鐘再以同一卡片發起一次 1 元扣款；系統不會自動重試第二筆扣款。</span>
          </label>
        ) : null}
        <FormSubmitButton
          pendingChildren="建立中…"
          pendingMessage="正在建立付款方式驗證 session，請勿重複送出。"
          className={isVendor
            ? "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
            : "inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"}
        >
          {isVendor ? "開始商店驗證" : "開始成員驗證"}
        </FormSubmitButton>
      </form>

      {handoff?.mode === "form_post" ? (
        <form action={handoff.formAction} method="post" className="space-y-2">
          {Object.entries(handoff.formPayload).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <p className="text-sm text-slate-700">設定資料已準備好。確認前往金流頁完成驗證；若金流要求首次交易，請先確認顯示的金額與條款。</p>
          <button type="submit" className="min-h-11 rounded-md border border-primary px-4 py-2 text-sm font-semibold text-primary">
            繼續至金流
          </button>
        </form>
      ) : null}
    </div>
  );
}
