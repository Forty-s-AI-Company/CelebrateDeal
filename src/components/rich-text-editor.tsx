"use client";

import { useRef, useState, type MouseEvent } from "react";
import { Bold, Heading2, Italic, Link2, List, ListOrdered } from "lucide-react";
import { RichTextContent } from "@/components/rich-text-content";
import { insertTextAtSelection } from "@/lib/rich-text";

type RichTextEditorProps = {
  name: string;
  label: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  maxLength: number;
  rows?: number;
  disabled?: boolean;
  errorId?: string;
  invalid?: boolean;
  insertTokens?: readonly { value: string; label: string }[];
  insertTokensLabel?: string;
};

export function RichTextEditor({
  name,
  label,
  defaultValue = "",
  value: controlledValue,
  onChange,
  required = false,
  maxLength,
  rows = 8,
  disabled = false,
  errorId,
  invalid = false,
  insertTokens = [],
  insertTokensLabel = "插入變數",
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const value = controlledValue ?? uncontrolledValue;

  function update(next: string) {
    if (controlledValue === undefined) setUncontrolledValue(next);
    onChange?.(next);
  }

  function replaceSelection(prefix: string, suffix = prefix, fallback = "文字") {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selection = value.slice(start, end) || fallback;
    const replacement = `${prefix}${selection}${suffix}`;
    update(`${value.slice(0, start)}${replacement}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selection.length);
    });
  }

  function insertToken(token: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      update(`${value}${token}`);
      return;
    }
    const next = insertTextAtSelection(value, textarea.selectionStart, textarea.selectionEnd, token);
    update(next.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  function preserveTextareaSelection(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${name}-rich-text`} className="text-sm font-medium text-slate-700">{label}</label>
        <span className="text-xs text-slate-500">支援標題、粗體、斜體、清單與 HTTPS 連結</span>
      </div>
      <div role="toolbar" aria-label={`${label}格式工具`} className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <button type="button" disabled={disabled} aria-label="粗體" title="粗體" onMouseDown={preserveTextareaSelection} onClick={() => replaceSelection("**")} className="grid h-9 w-9 place-items-center rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-50"><Bold size={16} /></button>
        <button type="button" disabled={disabled} aria-label="斜體" title="斜體" onMouseDown={preserveTextareaSelection} onClick={() => replaceSelection("*")} className="grid h-9 w-9 place-items-center rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-50"><Italic size={16} /></button>
        <button type="button" disabled={disabled} aria-label="標題" title="標題" onMouseDown={preserveTextareaSelection} onClick={() => replaceSelection("## ", "", "標題")} className="grid h-9 w-9 place-items-center rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-50"><Heading2 size={16} /></button>
        <button type="button" disabled={disabled} aria-label="項目清單" title="項目清單" onMouseDown={preserveTextareaSelection} onClick={() => replaceSelection("- ", "", "項目")} className="grid h-9 w-9 place-items-center rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-50"><List size={16} /></button>
        <button type="button" disabled={disabled} aria-label="編號清單" title="編號清單" onMouseDown={preserveTextareaSelection} onClick={() => replaceSelection("1. ", "", "項目")} className="grid h-9 w-9 place-items-center rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-50"><ListOrdered size={16} /></button>
        <button type="button" disabled={disabled} aria-label="插入連結" title="插入連結" onMouseDown={preserveTextareaSelection} onClick={() => replaceSelection("[", "](https://)", "連結文字")} className="grid h-9 w-9 place-items-center rounded border border-slate-200 bg-white text-slate-700 disabled:opacity-50"><Link2 size={16} /></button>
      </div>
      {insertTokens.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 p-2" aria-label={insertTokensLabel}>
          <span className="text-xs font-semibold text-blue-900">{insertTokensLabel}</span>
          {insertTokens.map((token) => (
            <button key={token.value} type="button" disabled={disabled} onMouseDown={preserveTextareaSelection} onClick={() => insertToken(token.value)} className="min-h-8 rounded-full border border-blue-200 bg-white px-2 text-xs font-mono font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50">
              {token.label}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        id={`${name}-rich-text`}
        name={name}
        required={required}
        maxLength={maxLength}
        rows={rows}
        disabled={disabled}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={errorId}
        onChange={(event) => update(event.target.value)}
        className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
      />
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label={`${label}即時預覽`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">即時預覽</p>
        {value.trim() ? <RichTextContent value={value} className="mt-2 text-sm leading-6 text-slate-700" /> : <p className="mt-2 text-sm text-slate-500">開始輸入後會在這裡顯示格式效果。</p>}
      </div>
    </div>
  );
}
