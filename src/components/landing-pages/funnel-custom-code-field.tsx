"use client";

import { useId, useRef, useState } from "react";
import { utf8ByteLength } from "@/lib/funnel-custom-code";
import { compileFunnelCustomCss, FUNNEL_PAGE_CUSTOM_CSS_MAX_BYTES } from "@/lib/funnel-custom-css";

const editorFrame = "grid grid-cols-[auto_1fr] overflow-hidden rounded-lg border border-slate-500 bg-slate-950 focus-within:border-blue-600 focus-within:ring-2 focus-within:ring-blue-100";
const codeText = "font-mono text-xs leading-5";

function kilobytes(bytes: number): string {
  return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
}

/**
 * 等寬字程式碼編輯框（textarea＋行號），不引入大型編輯器套件。
 * 超過大小上限或 `validate` 回傳錯誤時不送出變更，只顯示原因。
 */
export function CodeTextarea({ label, value, maxBytes, disabled, description, rows = 10, validate, onCommit }: {
  label: string; value: string; maxBytes: number; disabled?: boolean; description?: string; rows?: number;
  validate?: (value: string) => string | null; onCommit: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [source, setSource] = useState(value);
  const gutterRef = useRef<HTMLDivElement>(null);
  // 外部（復原、切換節點）改變值時同步草稿；自己剛送出的值與草稿相同，不影響游標。
  if (source !== value) { setSource(value); setDraft(value); }
  const bytes = utf8ByteLength(draft);
  const tooLarge = bytes > maxBytes;
  const invalid = tooLarge ? `超過 ${kilobytes(maxBytes)} 上限，這次輸入不會儲存。` : validate?.(draft) ?? null;
  const lines = Math.max(draft.split("\n").length, rows);
  const update = (next: string) => {
    setDraft(next);
    const nextInvalid = utf8ByteLength(next) > maxBytes || Boolean(validate?.(next));
    if (!nextInvalid && next !== value) onCommit(next);
  };
  return <div className="grid gap-1 text-sm font-semibold text-slate-700">
    <label htmlFor={id}>{label}</label>
    <div className={editorFrame}>
      <div ref={gutterRef} aria-hidden className={`${codeText} select-none overflow-hidden bg-slate-900 px-2 py-2 text-right text-slate-500`} style={{ height: `${rows * 1.25 + 1}rem` }}>
        {Array.from({ length: lines }, (_, index) => <div key={index}>{index + 1}</div>)}
      </div>
      <textarea
        id={id}
        value={draft}
        disabled={disabled}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={`${id}-hint`}
        onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }}
        onChange={(event) => update(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Tab 插入兩個空白；Esc 之後再按 Tab 仍可離開欄位（textarea 預設行為）。
          if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          const target = event.currentTarget;
          const { selectionStart, selectionEnd } = target;
          const next = `${draft.slice(0, selectionStart)}  ${draft.slice(selectionEnd)}`;
          update(next);
          requestAnimationFrame(() => { target.selectionStart = target.selectionEnd = selectionStart + 2; });
        }}
        className={`${codeText} min-w-0 resize-y bg-slate-950 px-3 py-2 text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-60`}
        style={{ height: `${rows * 1.25 + 1}rem`, tabSize: 2 }}
      />
    </div>
    <span id={`${id}-hint`} className="flex flex-wrap justify-between gap-2 text-xs font-normal leading-5">
      <span className={invalid ? "text-red-700" : "text-slate-600"} role={invalid ? "alert" : undefined}>{invalid ?? description}</span>
      <span className={tooLarge ? "text-red-700" : "text-slate-500"}>{kilobytes(bytes)} / {kilobytes(maxBytes)}</span>
    </span>
  </div>;
}

/** 頁面設定「自訂 CSS」：即時用與伺服器相同的編譯器檢查，錯誤時不寫入文件。 */
export function PageCustomCssField({ value, disabled, onCommit }: { value: string | undefined; disabled: boolean; onCommit: (value: string | undefined) => void }) {
  return <CodeTextarea
    label="頁面自訂 CSS"
    value={value ?? ""}
    maxBytes={FUNNEL_PAGE_CUSTOM_CSS_MAX_BYTES}
    disabled={disabled}
    rows={8}
    description="只作用在頁面內容。html、body、:root 會套用到頁面內容容器；不支援 @import、反斜線與 [value] 選擇器，url() 只接受 https://。需 owner 或 admin。"
    validate={(css) => { const compiled = compileFunnelCustomCss(css); return compiled.ok ? null : compiled.error; }}
    onCommit={(css) => onCommit(css.trim() ? css : undefined)}
  />;
}
