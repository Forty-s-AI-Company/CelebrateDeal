"use client";

import { useEffect, useRef, useState } from "react";
import { liveSlugFromTitle, randomLiveSlugSuffix } from "@/lib/live-slug";

/**
 * 「直播網址」欄位：在使用者自己改過之前，會跟著直播標題自動產生；
 * 網址已被使用時（送出被擋下，或草稿存檔時伺服器回報）在欄位上顯示錯誤。
 */
export function LiveSlugField({
  title,
  initialValue,
  serverTaken,
  draftTaken,
  checkFailed = false,
  onChange,
  onAutoFill,
}: {
  title: string;
  initialValue: string;
  /** 上一次送出因撞名被擋下（`?error=slug_taken`）。 */
  serverTaken: boolean;
  /** 最近一次草稿存檔時，伺服器回報這個網址已被使用。 */
  draftTaken: boolean;
  /** 草稿存檔時伺服器暫時無法檢查網址是否重複。 */
  checkFailed?: boolean;
  onChange: (value: string) => void;
  /** 自動產生網址後通知外層儲存草稿（讀取的是 DOM 上已更新的值）。 */
  onAutoFill: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(Boolean(initialValue));
  const [edited, setEdited] = useState(false);
  const [autoFillCount, setAutoFillCount] = useState(0);
  const suffixRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(initialValue);

  useEffect(() => {
    // F-117: 送出因撞名被擋下時，把焦點帶回網址欄位。
    if (serverTaken) inputRef.current?.focus();
    // 只在載入帶有伺服器錯誤的頁面時執行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (touched) return;
    if (!suffixRef.current) suffixRef.current = randomLiveSlugSuffix();
    const next = title.trim() ? liveSlugFromTitle(title, suffixRef.current) : "";
    if (next === valueRef.current) return;
    valueRef.current = next;
    setValue(next);
    setAutoFillCount((count) => count + 1);
  }, [title, touched]);

  useEffect(() => {
    if (autoFillCount === 0) return;
    onChange(value);
    onAutoFill();
    // 只在自動產生之後通知一次；value 變動由使用者輸入處理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFillCount]);

  const taken = (draftTaken && value.trim() !== "") || (serverTaken && !edited);
  const messageId = "live-slug-message";
  const message = taken
    ? "這個直播網址已被使用，請換一個（可在後面加上日期或編號）。"
    : checkFailed
      ? "暫時無法檢查這個網址是否重複，送出時會再確認。"
      : "觀眾會用這個網址進入直播間。預設會依標題自動產生，你也可以自己修改。";

  return (
    <div className="grid gap-1.5 text-sm font-medium text-slate-700">
      <label htmlFor="live-slug">直播網址</label>
      <span className="flex min-w-0 items-center overflow-hidden rounded-md border border-border bg-white focus-within:ring-2 focus-within:ring-blue-100">
        <span aria-hidden="true" className="shrink-0 bg-slate-50 px-3 py-2.5 text-xs font-normal text-slate-500">/live/</span>
        <input
          id="live-slug"
          ref={inputRef}
          name="slug"
          required
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setTouched(true);
            setEdited(true);
            valueRef.current = event.target.value;
            setValue(event.target.value);
            onChange(event.target.value);
          }}
          aria-invalid={taken}
          aria-describedby={messageId}
          placeholder="例如：friday-new-arrivals"
          className="h-10 min-w-0 flex-1 px-3 outline-none"
        />
      </span>
      <span id={messageId} role={taken ? "alert" : undefined} className={`text-xs font-normal ${taken ? "text-red-700" : "text-slate-500"}`}>
        {message}
      </span>
    </div>
  );
}
