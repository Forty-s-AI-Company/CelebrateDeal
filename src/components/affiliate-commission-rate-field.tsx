"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFieldMessages } from "@/components/ui";
import { bpsToPercentText, parsePercentText, PERCENT_INPUT_PATTERN, percentTextToBpsWire } from "@/lib/percent-bps";

const subscribeNever = () => () => {};
export const AFFILIATE_RATE_MESSAGE = "請填 0 到 100 的數字，最多兩位小數。";
/** 與伺服器 `MAX_COMMISSION_RATE_BPS` 相同（那個檔案引用 node:crypto，不能進瀏覽器）；測試會比對兩者。 */
export const AFFILIATE_RATE_MAX_BPS = 10_000;

/**
 * 聯盟夥伴的固定佣金比例：畫面上用百分比，伺服器欄位仍是 `commissionRateBps`（0 到 10000 的整數）。
 * 送出的是隱藏欄位（`percentTextToBpsWire`：整數運算、不四捨五入；空白或不合法時送 `invalid:`，
 * 伺服器的 `Number()` 會得到 NaN 而拒絕，不會變成 0）。隱藏欄位只在 React 接手後才會跟著輸入更新，
 * 所以 hydrate 前輸入框是 readOnly。
 */
export function AffiliateCommissionRateField({ initialBps }: { initialBps: number }) {
  // 資料庫值超出可表示範圍時留空（隱藏欄位送 invalid:），要求重新填寫，而不是猜一個比例。
  const [percent, setPercent] = useState(() => Number.isSafeInteger(initialBps) && initialBps >= 0 && initialBps <= AFFILIATE_RATE_MAX_BPS ? bpsToPercentText(initialBps) : "");
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parsePercentText(percent);
  // 格式錯誤由 required／pattern 原生擋下；超過 100% 的合法格式另以自訂驗證訊息擋下。
  const overLimit = parsed.kind === "ok" && parsed.bps > AFFILIATE_RATE_MAX_BPS;
  const error = parsed.kind === "invalid" || overLimit ? AFFILIATE_RATE_MESSAGE : null;
  const field = useFieldMessages(error, "填 10 代表 10%，最多兩位小數。");
  useEffect(() => { inputRef.current?.setCustomValidity(overLimit ? AFFILIATE_RATE_MESSAGE : ""); }, [overLimit]);
  return <div className="grid gap-1.5">
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      佣金比例（%）
      <input
        {...field.controlProps}
        ref={inputRef}
        className={`h-11 rounded-md border bg-white px-3 text-sm transition ${field.controlClass}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required
        pattern={PERCENT_INPUT_PATTERN}
        readOnly={!hydrated}
        value={percent}
        onChange={event => setPercent(event.target.value)}
        data-field-name="commissionRateBps"
      />
    </label>
    {field.messages}
    {hydrated ? null : <span data-rate-loading="" className="text-xs font-normal text-slate-600">頁面載入完成後才能修改。</span>}
    <input type="hidden" name="commissionRateBps" value={percentTextToBpsWire(percent)} />
  </div>;
}
