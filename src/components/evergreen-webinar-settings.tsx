import { updateEvergreenWebinarSettingsAction } from "@/app/actions/evergreen-webinar-actions";
import { Card, Field, SelectField, SubmitButton } from "@/components/ui";

export type EvergreenWebinarSettingsValue = {
  isEvergreen: boolean;
  evergreenScheduleMode: "just_in_time" | "recurring_daily" | "on_demand";
  evergreenIntervalMinutes: 5 | 15 | 30;
  evergreenDailyTimes: string[];
  evergreenSessionStartAt: string;
  evergreenPitchAtSeconds: number | null;
  evergreenConsultationAtSeconds: number | null;
  evergreenPreviewEnabled: boolean;
  evergreenPreviewRate: 0.5 | 1 | 1.25 | 1.5 | 2;
};

export function EvergreenWebinarSettings({
  liveId,
  csrfToken,
  value,
  error,
  notice,
}: {
  liveId: string;
  csrfToken: string;
  value: EvergreenWebinarSettingsValue;
  error?: string;
  notice?: string;
}) {
  return (
    <Card className="mb-6">
      <form action={updateEvergreenWebinarSettingsAction} className="grid gap-4">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <input type="hidden" name="liveId" value={liveId} />
        <div>
          <h2 className="text-lg font-semibold text-slate-950">常青 Webinar 設定</h2>
          <p className="mt-1 text-sm text-slate-600">沿用這場直播目前的來源影片；公開觀看永遠鎖定正常倍速。</p>
        </div>
        <div role="note" className="grid gap-1 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-sm text-slate-700">
          <p><strong>公開觀看頁如何運作：</strong>啟用後，每位觀眾第一次進入觀看頁或線上講座感謝頁時，系統會依商家時區為他安排專屬場次，重新整理也不會改變；場次開始前顯示等候室倒數，開始後以正常倍速從場次進度播放，觀眾無法快轉或加速。</p>
          <ul className="list-disc pl-5 text-xs leading-5 text-slate-600">
            <li>即時入場：排入下一個整點間隔（例如每 15 分鐘的 :00、:15、:30、:45）；每日固定場次：排入進行中或下一個時段；隨選播放：從觀眾第一次進入時開始。</li>
            <li>優惠券、諮詢 CTA 與互動腳本的商品聚焦、CTA，只會在該觀眾的場次播放到設定秒數後才由伺服器送出。</li>
            <li>場次結束後依直播的「回放」設定開放回放；未開放時觀眾可自行安排下一場。抽獎、投票、紅包與快閃搶購為全場共用互動，常青場次不會出現。</li>
            <li>頁面會標示「預錄場次」，不會宣稱為即時直播。變更排程設定後，既有觀眾的場次會重新安排。</li>
          </ul>
        </div>
        {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{evergreenError(error)}</p> : null}
        {notice === "evergreen_saved" ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">常青 Webinar 設定已儲存。</p> : null}
        <label className="flex items-start gap-3 rounded-md border border-border p-3 text-sm text-slate-700">
          <input name="isEvergreen" type="checkbox" defaultChecked={value.isEvergreen} className="mt-1 size-4" />
          <span><span className="font-semibold">啟用常青 Webinar</span><br /><span className="text-slate-500">停用時會清除常青排程與預覽控制，不影響原本直播資料。</span></span>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="開播模式" name="evergreenScheduleMode" defaultValue={value.evergreenScheduleMode}>
            <option value="just_in_time">即時入場（依間隔湊場）</option>
            <option value="recurring_daily">每日固定場次</option>
            <option value="on_demand">隨選播放</option>
          </SelectField>
          <SelectField label="即時入場間隔" name="evergreenIntervalMinutes" defaultValue={String(value.evergreenIntervalMinutes)}>
            <option value="5">每 5 分鐘</option>
            <option value="15">每 15 分鐘</option>
            <option value="30">每 30 分鐘</option>
          </SelectField>
          <Field label="可選排程錨點（商家時區）" name="evergreenSessionStartAt" type="datetime-local" defaultValue={value.evergreenSessionStartAt} />
        </div>
        <p className="-mt-2 text-xs text-slate-500">設定排程錨點後，所有觀眾共用這一個開場時間（取代上方開播模式）；留空則依開播模式為每位觀眾安排場次。</p>
        <fieldset className="grid gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">每日固定場次</legend>
          <p className="text-xs text-slate-500">只在「每日固定場次」使用；最多可設定 4 個時段。</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <label key={index} className="grid gap-1 text-sm text-slate-700">場次 {index + 1}
                <input className="h-11 rounded-md border border-border-control bg-white px-3 text-sm" name="evergreenDailyTimes" type="time" defaultValue={value.evergreenDailyTimes[index] ?? ""} />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="優惠券出現秒數" name="evergreenPitchAtSeconds" type="number" min={0} defaultValue={value.evergreenPitchAtSeconds} />
          <Field label="諮詢 CTA 出現秒數" name="evergreenConsultationAtSeconds" type="number" min={0} defaultValue={value.evergreenConsultationAtSeconds} />
        </div>
        <fieldset className="grid gap-3 rounded-md border border-blue-100 bg-blue-50/60 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">商家預覽</legend>
          <label className="flex items-center gap-2 text-sm text-slate-700"><input name="evergreenPreviewEnabled" type="checkbox" defaultChecked={value.evergreenPreviewEnabled} />啟用預覽模式</label>
          <SelectField label="預覽播放倍速（只影響商家預覽）" name="evergreenPreviewRate" defaultValue={String(value.evergreenPreviewRate)}>
            <option value="0.5">0.5×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option>
          </SelectField>
        </fieldset>
        <div><SubmitButton>儲存常青設定</SubmitButton></div>
      </form>
    </Card>
  );
}

function evergreenError(error: string) {
  if (error === "evergreen_video_required") return "啟用常青 Webinar 前，請先在 Studio 綁定可播放的來源影片。";
  if (error === "invalid_evergreen_schedule") return "排程起點無效，請依商家時區重新選擇日期與時間。";
  if (error === "evergreen_timing_out_of_range") return "優惠券或諮詢 CTA 秒數不能超過來源影片長度。";
  return "常青 Webinar 設定無法儲存，請檢查欄位後再試。";
}
