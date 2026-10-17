"use client";

import { useActionState, useState } from "react";
import { updateRichMenuDraftAction, type RichMenuActionState } from "@/app/actions/line-rich-menu-actions";
import { createRichMenuTemplate, type LineRichMenu, type LineRichMenuTemplateType } from "@/lib/line-rich-menu";
import type { RichMenuPublicationView } from "@/lib/line-rich-menu-draft-content";

export type RichMenuDraftView = { id: string; revision: number; menu: LineRichMenu;publication?:RichMenuPublicationView|null };
const errors = {
  invalid_input: "請檢查文字長度、網址與選單區塊設定。",
  conflict: "草稿已在其他分頁更新或刪除。請重新載入頁面後再編輯。",
  save_failed: "目前無法儲存，請稍後再試。",
  locked:"同步正在進行或結果尚未確認，請先確認 LINE 目前狀態。",
  not_configured:"請先確認同一個 LINE 官方帳號已連接，且憑證有效。",
  invalid_image:"請選擇完整的 PNG 或 JPEG 圖片。",
  image_too_large:"圖片需小於或等於 1 MB。",
  image_size_mismatch:"圖片尺寸與此選單畫布不一致。",
  unresolved_links:"請填妥此範本使用的所有同步連結。",
  sync_failed:"同步尚未完成，請檢查連線與草稿設定。",
};
const publicationCopy={syncing:"正在同步至 LINE；若操作中斷，稍後可確認目前狀態。",synced:"LINE 已確認使用這次同步的選單。",uncertain:"同步結果尚未確認。請先確認 LINE 目前狀態，避免重複發布。",failed:"這次同步尚未完成。",conflict:"草稿或 LINE 預設選單已變動，尚未確認同步。",outdated:"草稿或官方帳號連線已變更，尚未同步此版本。"};

function PublicationFeedback({publication,unsaved}:{publication:RichMenuPublicationView|null;unsaved:boolean}) {
  if(!publication)return null;
  return <p role="status" className="text-sm">{unsaved&&publication.status==="synced"?publicationCopy.outdated:publicationCopy[publication.status]}{publication.confirmedAt?` 上次確認：${new Date(publication.confirmedAt).toLocaleString("zh-TW")}`:""}</p>;
}

/** Preview cells never navigate to user-provided URLs or contact LINE. */
export function LineRichMenuStudio({ csrfToken, existing,connected=false,accountId }: { csrfToken: string; existing: RichMenuDraftView | null;connected?:boolean;accountId?:string }) {
  const [menu, setMenu] = useState<LineRichMenu>(() => existing?.menu ?? createRichMenuTemplate("golden-6"));
  const initial: RichMenuActionState = {
    status: "idle", error: null, reference: existing ? { id: existing.id, revision: existing.revision } : null,
  };
  const [state, action, pending] = useActionState(updateRichMenuDraftAction, initial);
  const publication=state.status==="deleted"?null:state.publication??existing?.publication??null;
  const locked=publication?.status==="syncing"||publication?.status==="uncertain";
  const unsaved=Boolean(existing&&JSON.stringify(menu)!==JSON.stringify(existing.menu));
  const load = (type: LineRichMenuTemplateType) => setMenu(createRichMenuTemplate(type));
  const updateArea = (index: number, key: "label" | "uri" | "text" | "data", value: string) => {
    setMenu((current) => ({ ...current, areas: current.areas.map((area, i) => i === index
      ? { ...area, action: { ...area.action, [key]: value } } : area) }));
  };

  return <section className="rounded-lg border border-border bg-white p-5 shadow-sm" aria-labelledby="rich-menu-heading">
    <h2 id="rich-menu-heading" className="text-lg font-semibold">LINE 圖文選單草稿</h2>
    <p className="mt-1 text-sm text-muted-foreground">先設定並儲存草稿，再上傳圖片、填入可公開的連結，手動同步至此商家的 LINE 官方帳號。同步會更換官方帳號的預設圖文選單。</p>
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="id" value={state.reference?.id ?? ""} />
      <input type="hidden" name="revision" value={state.reference?.revision ?? 0} />
      <input type="hidden" name="menu" value={JSON.stringify(menu)} />
      <fieldset disabled={pending||locked} className="space-y-4 disabled:opacity-60">
        <legend className="sr-only">圖文選單內容</legend>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => load("golden-6")} className="min-h-11 rounded-md border px-4">載入銷講 6 格範本</button>
          <button type="button" onClick={() => load("minimal-4")} className="min-h-11 rounded-md border px-4">載入極簡 4 格範本</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">選單名稱<input required maxLength={300} className="min-h-11 rounded-md border px-3" value={menu.name} onChange={(e) => setMenu({ ...menu, name: e.target.value })} /></label>
          <label className="grid gap-1 text-sm">選單列文字<input required maxLength={14} className="min-h-11 rounded-md border px-3" value={menu.chatBarText} onChange={(e) => setMenu({ ...menu, chatBarText: e.target.value })} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {menu.areas.map((area, index) => {
            const key = area.action.type === "uri" ? "uri" : area.action.type === "message" ? "text" : "data";
            const value = area.action.type === "uri" ? area.action.uri : area.action.type === "message" ? area.action.text : area.action.data;
            return <fieldset key={index} className="space-y-2 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">按鈕 {index + 1}</legend>
              <label className="grid gap-1 text-sm">按鈕文字<input required maxLength={20} className="min-h-11 rounded-md border px-3" value={area.action.label} onChange={(e) => updateArea(index, "label", e.target.value)} /></label>
              <label className="grid gap-1 text-sm">{key === "uri" ? "連結或範本代碼" : key === "text" ? "訊息" : "回傳資料"}<input required maxLength={key === "uri" ? 1000 : 300} className="min-h-11 rounded-md border px-3" value={value} onChange={(e) => updateArea(index, key, e.target.value)} /></label>
            </fieldset>;
          })}
        </div>
        {state.reference ? <fieldset className="space-y-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">同步至 LINE</legend>
          <p className="text-sm">先儲存草稿，再選擇圖片。尺寸須為 {menu.size.width} × {menu.size.height}，PNG 或 JPEG，最多 1 MB。此步驟不會自動寄送通知。</p>
          <label className="grid gap-1 text-sm">選單圖片<input type="file" name="image" accept="image/png,image/jpeg" className="min-h-11 rounded-md border p-2" /></label>
          {([ ["live_url","直播公開連結"],["consultation_url","諮詢公開連結"],["portal_url","學員入口公開連結"],["voucher_url","優惠券公開連結"] ] as const).map(([name,label])=><label key={name} className="grid gap-1 text-sm">{label}<input name={name} maxLength={1000} defaultValue={publication?.links[name]??""} className="min-h-11 rounded-md border px-3" /></label>)}
          {!connected?<p className="text-sm">請先連接 LINE 官方帳號。</p>:null}
          {unsaved?<p className="text-sm">目前編輯尚未儲存，請先儲存草稿。</p>:null}
          <button name="intent" value="sync" disabled={!connected||unsaved} className="min-h-11 rounded-md bg-blue-700 px-4 text-white disabled:opacity-50">上傳圖片並同步選單</button>
        </fieldset>:null}
        <div className="flex flex-wrap gap-3">
          <button name="intent" value="save" className="min-h-11 rounded-md bg-blue-700 px-4 text-white">{pending ? "處理中…" : "儲存草稿"}</button>
          {state.reference ? <button name="intent" value="delete" formNoValidate className="min-h-11 rounded-md border px-4">刪除草稿</button> : null}
        </div>
      </fieldset>
      <PublicationFeedback publication={publication} unsaved={unsaved}/>
      {locked&&state.reference?<button name="intent" value="reconcile" formNoValidate disabled={pending||!connected} className="min-h-11 rounded-md border px-4">確認 LINE 目前狀態</button>:null}
      {state.status === "error" ? <p role="alert" className="text-sm text-destructive">{state.error ? errors[state.error] : errors.save_failed}</p> : null}
      {state.status === "saved" || state.status === "deleted" ? <p role="status" className="text-sm">{state.status === "saved" ? "草稿已儲存。" : "草稿已刪除，可重新編輯後儲存。這不會移除 LINE 目前的預設選單。"}</p> : null}
    </form>
    <div className="mx-auto mt-6 max-w-sm" aria-label="圖文選單預覽">
      <div className="relative overflow-hidden rounded-lg bg-slate-900" style={{ aspectRatio: `${menu.size.width}/${menu.size.height}` }}>
        {menu.areas.map((area, index) => <div key={index} className="absolute flex items-center justify-center border border-white/30 p-2 text-center text-xs text-white" style={{
          left: `${area.bounds.x / menu.size.width * 100}%`, top: `${area.bounds.y / menu.size.height * 100}%`,
          width: `${area.bounds.width / menu.size.width * 100}%`, height: `${area.bounds.height / menu.size.height * 100}%`,
        }}>{area.action.label}</div>)}
      </div>
      <p className="py-2 text-center text-sm">{menu.chatBarText}</p>
    </div>
  </section>;
}
