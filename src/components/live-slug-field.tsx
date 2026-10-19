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
  onChange,
  onAutoFill,
}: {
  title: string;
  initialValue: string;
  /** 上一次送出因撞名被擋下（`?error=slug_taken`）。 */
  serverTaken: boolean;
  /** 最近一次草稿存檔時，伺服器回報這個網址已被使用。 */
  draftTaken: boolean;
  onChange: (value: string) => void;
  /** 自動產生網址後通知外層儲存草稿（讀取的是 DOM 上已更新的值）。 */
  onAutoFill: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(Boolean(initialValue));
  const [edited, setEdited] = useState(false);
  const [autoFillCount, setAutoFillCount] = useState(0);
  const suffixRef = useRef("");

  useEffect(() => {
    if (touched) return;
    if (!suffixRef.current) suffixRef.current = randomLiveSlugSuffix();
    const next = title.trim() ? liveSlugFromTitle(title, suffixRef.current) : "";
    setValue((current) => {
      if (current === next) return current;
      setAutoFillCount((count) => count + 1);
      return next;
    });
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

  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      直播網址
      <span className="flex min-w-0 items-center overflow-hidden rounded-md border border-border bg-white focus-within:ring-2 focus-within:ring-blue-100">
        <span aria-hidden="true" className="shrink-0 bg-slate-50 px-3 py-2.5 text-xs font-normal text-slate-500">/live/</span>
        <input
          name="slug"
          required
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setTouched(true);
            setEdited(true);
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
        {taken
          ? "這個直播網址已被使用，請換一個（可在後面加上日期或編號）。"
          : "觀眾會用這個網址進入直播間。預設會依標題自動產生，你也可以自己修改。"}
      </span>
    </label>
  );
}
