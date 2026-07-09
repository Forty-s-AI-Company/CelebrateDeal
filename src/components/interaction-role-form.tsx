"use client";

import Image from "next/image";
import { useState } from "react";
import type { InteractionRole } from "@prisma/client";
import { Bot, CheckCircle2, Sparkles } from "lucide-react";
import { upsertInteractionRoleAction } from "@/app/actions";
import { SubmitButton } from "@/components/ui";

const avatarSeeds = [
  "host-blue",
  "host-orange",
  "support-green",
  "editor-purple",
  "advisor-cyan",
  "reminder-rose",
  "sales-amber",
  "qa-indigo",
  "care-teal",
  "promo-red",
  "guide-slate",
  "assistant-lime",
  "planner-pink",
  "stream-navy",
  "helper-gold",
  "official-mint",
];

function avatarUrl(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

export function InteractionRoleForm({ role }: { role?: InteractionRole }) {
  const [selectedAvatar, setSelectedAvatar] = useState(role?.avatarUrl ?? avatarUrl(avatarSeeds[0]));
  const [roleType, setRoleType] = useState(role?.roleType ?? "official");

  return (
    <form action={upsertInteractionRoleAction} className="grid gap-6">
      {role ? <input type="hidden" name="id" value={role.id} /> : null}
      <input type="hidden" name="avatarUrl" value={selectedAvatar} />

      <section className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-slate-950 via-blue-800 to-blue-600 p-6 text-white">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
            <Bot size={14} />
            官方互動代理
          </p>
          <h1 className="mt-3 text-2xl font-bold">選一個插畫頭像，輸入暱稱就能建立角色</h1>
          <p className="mt-2 max-w-2xl text-sm text-blue-50">頭像統一使用插畫式 SVG，不使用真實人臉，降低設定摩擦，也讓品牌角色保持合規、清楚、可控。</p>
        </div>

        <div className="grid gap-6 p-5 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center shadow-inner">
            <Image src={selectedAvatar} alt="目前選取的插畫頭像" width={180} height={180} unoptimized className="mx-auto h-44 w-44 rounded-3xl bg-white p-3 shadow-lg" />
            <p className="mt-4 text-sm font-semibold text-slate-950">目前選取頭像</p>
            <p className="mt-1 text-xs text-slate-500">系統插畫頭像，可直接使用。</p>
          </aside>

          <div className="grid gap-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">預設頭像</h2>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{avatarSeeds.length} 種</span>
              </div>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
                {avatarSeeds.map((seed) => {
                  const url = avatarUrl(seed);
                  const active = selectedAvatar === url;
                  return (
                    <button
                      key={seed}
                      type="button"
                      onClick={() => setSelectedAvatar(url)}
                      className={`relative rounded-2xl border bg-white p-2 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                        active ? "border-blue-500 ring-4 ring-blue-100" : "border-slate-200"
                      }`}
                    >
                      <Image src={url} alt="" width={72} height={72} unoptimized className="aspect-square w-full rounded-xl bg-slate-50" />
                      {active ? <CheckCircle2 size={18} className="absolute right-1 top-1 text-blue-600" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                暱稱
                <input name="name" required defaultValue={role?.name ?? ""} placeholder="例如：官方商品顧問" className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  角色類型
                  <select name="roleType" value={roleType} onChange={(event) => setRoleType(event.target.value)} className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100">
                    <option value="official">官方角色</option>
                    <option value="ai_host">AI 主持人</option>
                    <option value="system_assistant">系統助手</option>
                    <option value="support">客服助手</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  顯示標籤
                  <input name="label" defaultValue={role?.label ?? (roleType === "ai_host" ? "AI 主持人" : roleType === "system_assistant" ? "系統助手" : roleType === "support" ? "客服助手" : "官方角色")} className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
                </label>
              </div>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                語氣設定
                <textarea name="tone" defaultValue={role?.tone ?? "溫和、清楚、像品牌官方小幫手，提醒優惠但不過度催促。"} rows={3} className="rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
              </label>

              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input name="isActive" type="checkbox" defaultChecked={role?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
                啟用角色
              </label>
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-end rounded-xl border border-border bg-white p-3 shadow-sm">
        <SubmitButton>
          <Sparkles size={16} />
          儲存互動角色
        </SubmitButton>
      </div>
    </form>
  );
}
