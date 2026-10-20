import { Landmark } from "lucide-react";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, SubmitButton } from "@/components/ui";
import { maskBankAccount } from "@/lib/bank-account";
import { saveVendorPayoutAccountAction } from "./actions";

export type PayoutAccountSummary = {
  status: string;
  bankAccountEncrypted: string | null;
  bankAccountLegacyName: string | null;
  bankCodeLegacy: string | null;
  bankAccountLegacyNumber: string | null;
};

const RESULT_MESSAGES: Record<string, { tone: "green" | "red"; text: string }> = {
  saved: { tone: "green", text: "撥款帳號已儲存。帳號以加密方式保存，畫面只顯示末四碼。" },
  invalid_account_name: { tone: "red", text: "請填寫戶名（100 字以內）。" },
  invalid_bank_code: { tone: "red", text: "銀行代碼請填 3 碼數字，或 3 碼銀行代碼加 4 碼分行代碼。" },
  invalid_account_number: { tone: "red", text: "帳號請填 6 到 20 碼數字，可省略連字號。" },
  encryption_unavailable: { tone: "red", text: "目前無法安全保存帳號，請稍後再試或聯絡平台客服。" },
  multiple_accounts: { tone: "red", text: "此商家有多筆撥款帳號紀錄，需由平台客服整理後才能修改。" },
  save_failed: { tone: "red", text: "儲存失敗，請重新整理後再試一次。" },
};

const STATUS_LABELS: Record<string, string> = {
  active: "啟用中",
  pending: "待設定",
  verified: "已驗證",
};

function accountDisplay(account: PayoutAccountSummary) {
  const { bankAccountLegacyName: name, bankCodeLegacy: code, bankAccountLegacyNumber: number } = account;
  if (name && code && number) {
    // Re-mask defensively: a pre-backfill row may still hold plaintext.
    return maskBankAccount({ accountName: name, bankCode: code, accountNumber: number });
  }
  return null;
}

export function PayoutAccountCard({
  account,
  canEdit,
  result,
}: {
  account: PayoutAccountSummary | null;
  canEdit: boolean;
  result?: string;
}) {
  const message = result ? RESULT_MESSAGES[result] : undefined;
  const display = account ? accountDisplay(account) : null;

  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
            <Landmark className="text-slate-400" size={18} aria-hidden />
            撥款帳號
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            平台月結後會把撥款匯入這個帳戶。帳號加密保存，後台只顯示末四碼。
          </p>
        </div>
        {account ? <Badge tone={account.status === "active" ? "green" : "gray"}>{STATUS_LABELS[account.status] ?? account.status}</Badge> : null}
      </div>

      {message ? (
        <p
          role={message.tone === "red" ? "alert" : "status"}
          className={message.tone === "red"
            ? "mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
            : "mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700"}
        >
          {message.text}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-slate-500">銀行代碼</dt>
          <dd className="mt-1 font-semibold text-slate-950">{display?.bankCode ?? "尚未設定"}</dd>
        </div>
        <div>
          <dt className="text-slate-500">帳號</dt>
          <dd className="mt-1 font-semibold text-slate-950">
            {display?.accountNumber ?? (account?.bankAccountEncrypted ? "已加密保存" : "尚未設定")}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">戶名</dt>
          <dd className="mt-1 font-semibold text-slate-950">{display?.accountName ?? "尚未設定"}</dd>
        </div>
      </dl>

      {canEdit ? (
        <form action={saveVendorPayoutAccountAction} className="mt-5 grid gap-4 border-t border-border pt-5">
          <CsrfField />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="戶名" name="accountName" required maxLength={100} autoComplete="off" />
            <Field label="銀行代碼" name="bankCode" required maxLength={7} placeholder="例如 812" autoComplete="off" />
            <Field label="帳號" name="accountNumber" required maxLength={24} autoComplete="off" />
          </div>
          <p className="text-xs text-slate-500">
            送出後會取代目前的撥款帳號；已建立的出款批次仍使用建立當時的帳號。修改需已啟用兩步驟驗證。
          </p>
          <div>
            <SubmitButton>{account ? "更新撥款帳號" : "儲存撥款帳號"}</SubmitButton>
          </div>
        </form>
      ) : (
        <p className="mt-5 border-t border-border pt-5 text-sm text-slate-500">只有商家擁有者可以修改撥款帳號。</p>
      )}
    </Card>
  );
}
