"use client";

import { useActionState, useMemo, useState } from "react";
import { deleteRichMenuAction, publishRichMenuToLineAction, saveRichMenuDraftAction, type RichMenuActionState } from "@/app/actions/line-rich-menu-actions";
import { createRichMenuTemplate, type LineRichMenu, type LineRichMenuTemplateType } from "@/lib/line-rich-menu";
import { SubmitButton } from "@/components/ui";

const initial: RichMenuActionState = { status: "idle", error: null };

export function LineRichMenuStudio({ csrfToken, existing }: { csrfToken: string; existing: { id: string; templateType: string; name: string; chatBarText: string; areas: LineRichMenu["areas"]; status: string; isDefault: boolean; syncedAt: string | null } | null }) {
  const initialType: LineRichMenuTemplateType = existing?.templateType === "minimal-4" ? "minimal-4" : "golden-6";
  const [type, setType] = useState<LineRichMenuTemplateType>(initialType);
  const [menu, setMenu] = useState<LineRichMenu>(() => existing ? { ...createRichMenuTemplate(initialType), name: existing.name, chatBarText: existing.chatBarText, areas: existing.areas } : createRichMenuTemplate(initialType));
  const [saveState, saveAction, savePending] = useActionState(saveRichMenuDraftAction, initial);
  const [publishState, publishAction, publishPending] = useActionState(publishRichMenuToLineAction, initial);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteRichMenuAction, initial);
  const serialized = useMemo(() => JSON.stringify(menu), [menu]);
  const load = (next: LineRichMenuTemplateType) => { setType(next); setMenu(createRichMenuTemplate(next)); };
  const fields = <><input type="hidden" name="_csrf" value={csrfToken}/><input type="hidden" name="id" value={existing?.id ?? ""}/><input type="hidden" name="templateType" value={type}/><input type="hidden" name="menu" value={serialized}/></>;
  const state = publishState.status !== "idle" ? publishState : saveState.status !== "idle" ? saveState : deleteState;
  return <section className="rounded-lg border border-border bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Rich Menu 圖文選單工作室</h2><p className="mt-1 text-sm text-muted-foreground">快速串起直播、諮詢、會員中心與專屬優惠。</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${existing?.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{existing?.status === "published" ? `已發布${existing.isDefault ? "・預設選單" : ""}` : "未發布"}</span></div>
    <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => load("golden-6")} className="min-h-11 rounded-md border px-4 text-sm font-semibold">載入銷講 6 格範本</button><button type="button" onClick={() => load("minimal-4")} className="min-h-11 rounded-md border px-4 text-sm font-semibold">載入極簡 4 格範本</button></div>
        <div className="grid gap-3 sm:grid-cols-2">{menu.areas.map((area, index) => <label key={`${type}-${index}`} className="grid gap-1 text-sm font-medium">{area.action.label}<input className="min-h-11 rounded-md border px-3 text-sm" value={area.action.uri ?? area.action.text ?? ""} onChange={(event) => setMenu((current) => ({ ...current, areas: current.areas.map((item, i) => i === index ? { ...item, action: { ...item.action, ...(item.action.type === "uri" ? { uri: event.target.value } : { text: event.target.value }) } } : item) }))}/></label>)}</div>
        <div className="flex flex-wrap gap-3"><form action={saveAction}>{fields}<SubmitButton disabled={savePending} pendingChildren="儲存中…">儲存草稿</SubmitButton></form><form action={publishAction} encType="multipart/form-data">{fields}<label className="mb-2 block text-xs text-muted-foreground">自訂 PNG/JPEG（選填，最大 10MB）<input className="mt-1 block text-sm" type="file" name="image" accept="image/png,image/jpeg"/></label><SubmitButton disabled={publishPending} pendingChildren="同步中…">同步至 LINE 官方帳號</SubmitButton></form>{existing ? <form action={deleteAction}>{fields}<SubmitButton disabled={deletePending} pendingChildren="移除中…">刪除選單</SubmitButton></form> : null}</div>
        {state.status !== "idle" ? <p role={state.status === "error" ? "alert" : "status"} className={`text-sm ${state.status === "error" ? "text-destructive" : "text-emerald-700"}`}>{state.status === "error" ? `操作失敗：${state.error}` : state.status === "published" ? "已同步並設為 LINE 預設選單。" : state.status === "deleted" ? "選單已移除。" : "草稿已儲存。"}</p> : null}
      </div>
      <div className="mx-auto w-full max-w-[320px] rounded-[2rem] border-[8px] border-slate-900 bg-slate-950 p-2 shadow-xl"><div className={`grid aspect-[2500/1686] overflow-hidden rounded-2xl ${type === "golden-6" ? "grid-cols-3" : "grid-cols-2"}`}>{menu.areas.map((area, index) => <a key={index} title={area.action.uri ?? area.action.text} href={area.action.uri?.startsWith("http") ? area.action.uri : undefined} className="flex items-center justify-center border border-white/20 p-2 text-center text-xs font-bold text-white" style={{ background: ["#1e3a8a","#7c2d12","#14532d","#581c87","#164e63","#111827"][index % 6] }}>{area.action.label}</a>)}</div><p className="py-2 text-center text-xs text-white">{menu.chatBarText}</p></div>
    </div>
  </section>;
}
