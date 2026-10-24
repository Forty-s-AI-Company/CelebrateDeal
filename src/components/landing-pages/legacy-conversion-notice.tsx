import type { LegacyConversionIssue } from "@/lib/legacy-landing-page-converter";

/**
 * Shown while a legacy page is open in the structured editor and has not been
 * saved yet. Nothing is written until the merchant saves.
 */
export function LegacyConversionNotice({ issues, published }: { issues: readonly LegacyConversionIssue[]; published: boolean }) {
  return <section aria-label="舊版頁面轉換說明" data-legacy-conversion-notice className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
    <p className="font-semibold">這是舊版頁面，已轉換成新版編輯器格式；儲存後會以新版格式保存。舊版內容在你儲存前不會被改動。</p>
    {published ? <p>儲存並重新發布後，公開頁才會改用新版內容。</p> : null}
    {issues.length ? <details className="mt-1">
      <summary className="cursor-pointer font-semibold text-amber-900 underline-offset-4 hover:underline">轉換報告：{issues.length} 項需要確認</summary>
      <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5">
        {issues.map((issue, index) => <li key={`${issue.blockId}-${index}`}><span className="font-semibold">{issue.blockLabel}</span>：{issue.message}</li>)}
      </ul>
    </details> : <p>所有內容都已轉換，沒有需要特別確認的項目。</p>}
  </section>;
}
