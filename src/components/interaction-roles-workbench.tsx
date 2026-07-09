"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { InteractionRole } from "@prisma/client";
import { ChevronLeft, ChevronRight, Plus, Save, Trash2 } from "lucide-react";
import { deleteInteractionRoleAction, upsertInteractionRoleAction } from "@/app/actions";

const avatarGroups = {
  male: [
    "host-blue",
    "support-green",
    "advisor-cyan",
    "sales-amber",
    "guide-slate",
    "stream-navy",
    "helper-gold",
    "official-mint",
    "promo-red",
    "qa-indigo",
  ],
  female: [
    "host-orange",
    "editor-purple",
    "reminder-rose",
    "care-teal",
    "assistant-lime",
    "planner-pink",
    "studio-rose",
    "brand-violet",
    "live-coral",
    "chat-mint",
  ],
};

function avatarUrl(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

function roleTypeLabel(roleType: string) {
  if (roleType === "ai_host") return "AI 主持人";
  if (roleType === "system_assistant") return "系統助手";
  if (roleType === "support") return "客服助手";
  return "官方角色";
}

export function InteractionRolesWorkbench({
  roles,
  selectedRole,
}: {
  roles: InteractionRole[];
  selectedRole?: InteractionRole | null;
}) {
  const [gender, setGender] = useState<"male" | "female">("male");
  const allSeeds = useMemo(() => avatarGroups[gender], [gender]);
  const initialIndex = Math.max(
    0,
    allSeeds.findIndex((seed) => avatarUrl(seed) === selectedRole?.avatarUrl),
  );
  const [avatarIndex, setAvatarIndex] = useState(initialIndex === -1 ? 0 : initialIndex);
  const selectedAvatar = avatarUrl(allSeeds[avatarIndex] ?? allSeeds[0]);
  const isEditing = Boolean(selectedRole);

  function shiftAvatar(direction: -1 | 1) {
    setAvatarIndex((current) => (current + direction + allSeeds.length) % allSeeds.length);
  }

  function switchGender(nextGender: "male" | "female") {
    setGender(nextGender);
    setAvatarIndex(0);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <aside className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-slate-50 p-4">
          <div>
            <h2 className="font-semibold text-slate-950">使用者清單</h2>
            <p className="text-sm text-slate-500">{roles.length} 個官方互動角色</p>
          </div>
          <Link href="/interaction-roles/new" className="grid h-9 w-9 place-items-center rounded-md bg-primary text-white shadow-sm hover:bg-primary-dark">
            <Plus size={17} />
          </Link>
        </div>
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-3">
          <Link
            href="/interaction-roles/new"
            className={`mb-2 flex items-center gap-3 rounded-lg border p-3 transition ${
              !selectedRole ? "border-blue-200 bg-blue-50 shadow-sm" : "border-transparent hover:bg-slate-50"
            }`}
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-blue-600 text-white">
              <Plus size={18} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-950">新增使用者</span>
              <span className="block text-xs text-slate-500">選頭像、輸入暱稱即可</span>
            </span>
          </Link>
          <div className="grid gap-2">
            {roles.map((role) => (
              <Link
                key={role.id}
                href={`/interaction-roles/${role.id}/edit`}
                className={`flex items-center gap-3 rounded-lg border p-3 transition ${
                  selectedRole?.id === role.id ? "border-blue-200 bg-blue-50 shadow-sm" : "border-transparent hover:bg-slate-50"
                }`}
              >
                {role.avatarUrl ? <Image src={role.avatarUrl} alt="" width={44} height={44} unoptimized className="h-11 w-11 rounded-full bg-slate-100 object-cover" /> : <span className="h-11 w-11 rounded-full bg-slate-100" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-950">{role.name}</span>
                  <span className="block truncate text-xs text-slate-500">{role.label} · {role.isActive ? "啟用" : "停用"}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </aside>

      <section className="overflow-hidden rounded-xl border border-blue-100 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-border bg-gradient-to-r from-slate-950 via-blue-800 to-blue-600 p-5 text-white md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold text-blue-100">互動角色</p>
            <h2 className="mt-1 text-2xl font-bold">{isEditing ? "編輯使用者" : "新增使用者"}</h2>
          </div>
          <p className="text-sm text-blue-50">向量插畫頭像，不使用真實人臉照。</p>
        </div>

        <form action={upsertInteractionRoleAction} className="grid gap-6 p-5">
          {selectedRole ? <input type="hidden" name="id" value={selectedRole.id} /> : null}
          <input type="hidden" name="avatarUrl" value={selectedAvatar} />

          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center shadow-inner">
              <div className="mb-4 flex justify-center rounded-lg bg-white p-1 shadow-sm">
                {(["male", "female"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => switchGender(item)}
                    className={`h-9 flex-1 rounded-md text-sm font-semibold transition ${
                      gender === item ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {item === "male" ? "男" : "女"}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3">
                <button type="button" onClick={() => shiftAvatar(-1)} className="grid h-9 w-9 place-items-center rounded-full border border-border bg-white text-slate-600 shadow-sm hover:bg-slate-50">
                  <ChevronLeft size={18} />
                </button>
                <Image src={selectedAvatar} alt="目前選取頭像" width={150} height={150} unoptimized className="h-36 w-36 rounded-3xl bg-white p-3 shadow-lg" />
                <button type="button" onClick={() => shiftAvatar(1)} className="grid h-9 w-9 place-items-center rounded-full border border-border bg-white text-slate-600 shadow-sm hover:bg-slate-50">
                  <ChevronRight size={18} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-5 gap-2">
                {allSeeds.map((seed, index) => {
                  const url = avatarUrl(seed);
                  return (
                    <button
                      key={seed}
                      type="button"
                      onClick={() => setAvatarIndex(index)}
                      className={`rounded-xl border bg-white p-1 transition hover:-translate-y-0.5 hover:shadow-sm ${
                        selectedAvatar === url ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"
                      }`}
                    >
                      <Image src={url} alt="" width={42} height={42} unoptimized className="aspect-square w-full rounded-lg" />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                暱稱
                <input name="name" required defaultValue={selectedRole?.name ?? ""} placeholder="Ex: 王小明" className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  角色類型
                  <select name="roleType" defaultValue={selectedRole?.roleType ?? "official"} className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100">
                    <option value="official">官方角色</option>
                    <option value="ai_host">AI 主持人</option>
                    <option value="system_assistant">系統助手</option>
                    <option value="support">客服助手</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  顯示標籤
                  <input name="label" defaultValue={selectedRole?.label ?? roleTypeLabel(selectedRole?.roleType ?? "official")} className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
                </label>
              </div>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                語氣設定
                <textarea name="tone" defaultValue={selectedRole?.tone ?? "溫和、清楚、像品牌官方小幫手，提醒優惠但不過度催促。"} rows={4} className="rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input name="isActive" type="checkbox" defaultChecked={selectedRole?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
                啟用使用者
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            {selectedRole ? (
              <button
                formAction={deleteInteractionRoleAction}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                <Trash2 size={16} />
                刪除
              </button>
            ) : null}
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark">
              {selectedRole ? <Save size={16} /> : <Plus size={16} />}
              {selectedRole ? "儲存" : "新增"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
