const PULSE = "animate-pulse motion-reduce:animate-none";

/**
 * 後台共用載入骨架：標題、統計卡片與清單列。側欄由 layout 保持不動，
 * 這裡只填主內容區，避免導覽時畫面只剩頂部進度條。
 * 動畫以 motion-reduce 關閉，狀態文字僅供輔助科技朗讀。
 */
export function WorkspaceLoadingSkeleton({
  id,
  title,
  description,
  statusMessage,
}: {
  id: string;
  title: string;
  description: string;
  statusMessage: string;
}) {
  const titleId = `${id}-title`;
  return (
    <section aria-busy="true" aria-live="polite" aria-labelledby={titleId} className="grid min-w-0 gap-6">
      <div>
        <h1 id={titleId} className="text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </div>
      <span role="status" className="sr-only">{statusMessage}</span>
      <div className="grid gap-6" aria-hidden="true">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className={`h-3 w-20 rounded bg-slate-200 ${PULSE}`} />
              <div className={`mt-4 h-8 w-28 rounded bg-slate-100 ${PULSE}`} />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-4">
            <div className={`h-4 w-40 rounded bg-slate-200 ${PULSE}`} />
          </div>
          <div className="grid gap-3 p-4">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3">
                <div className={`h-10 w-10 shrink-0 rounded-lg bg-slate-100 ${PULSE}`} />
                <div className="grid flex-1 gap-2">
                  <div className={`h-3 w-2/3 rounded bg-slate-200 ${PULSE}`} />
                  <div className={`h-3 w-1/3 rounded bg-slate-100 ${PULSE}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
