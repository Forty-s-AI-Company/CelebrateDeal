"use client";

import { useActionState, useState } from "react";
import { updateRichMenuDraftAction, type RichMenuActionState } from "@/app/actions/line-rich-menu-actions";
import { createRichMenuTemplate, type LineRichMenu, type LineRichMenuTemplateType } from "@/lib/line-rich-menu";

export type RichMenuDraftView = { id: string; revision: number; menu: LineRichMenu };
const errors = {
  invalid_input: "請檢查文字長度、網址與選單區塊設定。",
  conflict: "草稿已在其他分頁更新或刪除。請重新載入頁面後再編輯。",
  save_failed: "目前無法儲存，請稍後再試。",
};

/** Preview cells never navigate to user-provided URLs or contact LINE. */
export function LineRichMenuStudio({ csrfToken, existing }: { csrfToken: string; existing: RichMenuDraftView | null }) {
  const [menu, setMenu] = useState<LineRichMenu>(() => existing?.menu ?? createRichMenuTemplate("golden-6"));
  const initial: RichMenuActionState = {
    status: "idle", error: null, reference: existing ? { id: existing.id, revision: existing.revision } : null,
  };
  const [state, action, pending] = useActionState(updateRichMenuDraftAction, initial);
  const load = (type: LineRichMenuTemplateType) => setMenu(createRichMenuTemplate(type));
  const updateArea = (index: number, key: "label" | "uri" | "text" | "data", value: string) => {
    setMenu((current) => ({ ...current, areas: current.areas.map((area, i) => i === index
      ? { ...area, action: { ...area.action, [key]: value } } : area) }));
  };

  return <section className="rounded-lg border border-border bg-white p-5 shadow-sm" aria-labelledby="rich-menu-heading">
    <h2 id="rich-menu-heading" className="text-lg font-semibold">LINE 圖文選單草稿</h2>
    <p className="mt-1 text-sm text-muted-foreground">先設定範本與按鈕，草稿會保存在此商家。同步至 LINE 的功能尚未開放。</p>
    <form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="_csrf" value={csrfToken} />
      <input type="hidden" name="id" value={state.reference?.id ?? ""} />
      <input type="hidden" name="revision" value={state.reference?.revision ?? 0} />
      <input type="hidden" name="menu" value={JSON.stringify(menu)} />
      <fieldset disabled={pending} className="space-y-4 disabled:opacity-60">
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
        <div className="flex flex-wrap gap-3">
          <button name="intent" value="save" className="min-h-11 rounded-md bg-blue-700 px-4 text-white">{pending ? "處理中…" : "儲存草稿"}</button>
          {state.reference ? <button name="intent" value="delete" formNoValidate className="min-h-11 rounded-md border px-4">刪除草稿</button> : null}
        </div>
      </fieldset>
      {state.status === "error" ? <p role="alert" className="text-sm text-destructive">{state.error ? errors[state.error] : errors.save_failed}</p> : null}
      {state.status === "saved" || state.status === "deleted" ? <p role="status" className="text-sm">{state.status === "saved" ? "草稿已儲存。" : "草稿已刪除，可重新編輯後儲存。"}</p> : null}
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
