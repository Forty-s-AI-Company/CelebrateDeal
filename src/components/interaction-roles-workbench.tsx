"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { InteractionRole } from "@prisma/client";
import { AlertTriangle, ChevronLeft, ChevronRight, MessageCircle, Plus, Radio, Save, Trash2 } from "lucide-react";
import {
  deleteInteractionRoleAction,
  upsertInteractionRoleActionState,
} from "@/app/actions";
import {
  initialInteractionRoleActionState,
  type InteractionRoleActionState,
} from "@/lib/interaction-role-action-state";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MediaUploadField, type MediaUploadPersistedValue } from "@/components/media-upload-field";
import {
  INTERACTION_AVATAR_SEEDS,
  isCanonicalInteractionRolePresetUrl,
  interactionRoleAvatarGender,
  interactionRoleAvatarUrl,
  interactionRoleLabelAfterTypeChange,
  interactionRoleTypeLabel,
  normalizePresentationRole,
  type InteractionRoleAvatarMode,
  type InteractionRoleType,
  type InteractionAvatarGender,
} from "@/lib/interaction-role";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import type { InteractionRoleUsage } from "@/lib/interaction-role-usage";

const DEFAULT_INTERACTION_AVATAR_SEED = "host-blue";

function InteractionRolePreview({
  avatarUrl,
  name,
  label,
  tone,
  isActive,
  presentationRole,
  isScheduled,
}: {
  avatarUrl: string;
  name: string;
  label: string;
  tone: string;
  isActive: boolean;
  presentationRole: InteractionRoleType;
  isScheduled: boolean;
}) {
  return (
    <section aria-labelledby="interaction-role-preview-title" className="grid gap-4 rounded-2xl border border-slate-700 bg-slate-950 p-5 text-white lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.7fr)]">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-200">公開直播外觀</p>
            <h3 id="interaction-role-preview-title" className="mt-1 text-lg font-bold">角色即時預覽</h3>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${isActive ? "bg-emerald-400/20 text-emerald-100" : "bg-amber-300/20 text-amber-100"}`}>
            {isActive ? "啟用" : "停用，不會顯示公開留言"}
          </span>
        </div>
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-white/15 bg-white/10 p-4">
          <Image src={avatarUrl} alt="" width={52} height={52} unoptimized className="h-13 w-13 shrink-0 rounded-full bg-white/10 object-cover" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold">{name}</p>
              <span className="rounded-full bg-blue-400/20 px-2 py-0.5 text-xs font-semibold text-blue-100">{label}</span>
              <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs text-white/75">
                {presentationRole === "official" ? "官方外觀" : "一般觀眾外觀"}
              </span>
              {isScheduled ? <span className="rounded-full bg-violet-400/20 px-2 py-0.5 text-xs font-semibold text-violet-100">排程角色</span> : null}
            </div>
            <p className="mt-2 text-sm leading-6 text-white/90">歡迎來到直播！實際訊息內容會在互動腳本的時間軸中設定。</p>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-white/80">
        <p className="flex items-center gap-2 font-semibold text-white"><MessageCircle size={16} aria-hidden="true" />商家設定摘要</p>
        <p className="mt-3 leading-6">語氣：{tone || "尚未設定"}</p>
        <p className="mt-3 text-xs leading-5 text-white/60">這個預覽不會發布訊息，也不會建立觀看、報名、訂單、付款、評論或成效資料。</p>
      </div>
    </section>
  );
}

function InteractionRoleUsageImpact({
  roleUsage,
  isActive,
}: {
  roleUsage: InteractionRoleUsage[];
  isActive: boolean;
}) {
  const affectedPublicMessages = roleUsage.reduce((sum, usage) => sum + usage.publicMessageCount, 0);
  const attachedLives = roleUsage.reduce((sum, usage) => sum + usage.liveCount, 0);

  return (
    <section aria-labelledby="interaction-role-usage-title" className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">變更前先確認</p>
          <h3 id="interaction-role-usage-title" className="mt-1 text-lg font-bold text-slate-950">腳本與直播使用狀況</h3>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">
          {roleUsage.length} 個腳本 · {attachedLives} 場直播
        </span>
      </div>

      {!isActive && affectedPublicMessages > 0 ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
          <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
          停用後，下列腳本中 {affectedPublicMessages} 個官方留言／提醒事件不會出現在公開直播。商品聚焦與 CTA 仍依各自腳本規則執行。
        </p>
      ) : null}

      {roleUsage.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-600">這個角色尚未被任何互動腳本使用，可以安全調整或刪除。</p>
      ) : (
        <>
          <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            刪除後，目前有 {roleUsage.length} 個腳本引用的事件會改顯示為官方系統；可先逐一檢查腳本再決定。
          </p>
          <ul className="mt-3 grid gap-3">
            {roleUsage.map((usage) => (
              <li key={usage.scriptId} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-950">{usage.scriptName}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>{usage.scriptStatus === "published" ? "已發布" : "草稿"}</span>
                    <span>· {usage.eventCount} 個引用事件</span>
                    <span>· {usage.liveCount} 場直播綁定</span>
                  </p>
                </div>
                <Link href={`/interaction-scripts/${usage.scriptId}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-100">
                  <Radio size={16} aria-hidden="true" />檢查腳本
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// 這個工作台同時承載清單、預覽、上傳與表單狀態；保留單一表單可避免切換角色時遺失草稿。
// eslint-disable-next-line max-lines-per-function, complexity
export function InteractionRolesWorkbench({
  roles,
  selectedRole,
  roleUsage = [],
  csrfToken,
  error,
  initialAvatarAssetId,
}: {
  roles: InteractionRole[];
  selectedRole?: InteractionRole | null;
  roleUsage?: InteractionRoleUsage[];
  csrfToken: string;
  error?: string | null;
  initialAvatarAssetId?: string | null;
}) {
  const selectedAvatarMode: InteractionRoleAvatarMode = isCanonicalInteractionRolePresetUrl(selectedRole?.avatarUrl)
    ? "preset"
    : "custom";
  const selectedPresentationRole = selectedRole ? normalizePresentationRole(selectedRole.roleType) : "official";
  const isLegacyRole = Boolean(selectedRole && selectedRole.roleType !== selectedPresentationRole);
  const initialState: InteractionRoleActionState = {
    ...initialInteractionRoleActionState,
    values: {
      ...initialInteractionRoleActionState.values,
      id: selectedRole?.id ?? "",
      name: selectedRole?.name ?? "",
      avatarUrl: selectedRole?.avatarUrl ?? "",
      avatarMode: selectedAvatarMode,
      label: selectedRole?.label ?? interactionRoleTypeLabel(selectedPresentationRole),
      roleType: selectedPresentationRole,
      tone: selectedRole?.tone ?? "溫和、清楚、像品牌官方小幫手，提醒優惠但不過度催促。",
      isActive: selectedRole?.isActive ?? true,
      isScheduled: selectedRole?.isScheduled ?? false,
    },
  };
  const [actionState, formAction, pending] = useActionState(upsertInteractionRoleActionState, initialState);
  const actionStateValues = actionState.status === "error" ? actionState.values : null;
  const [actionStateEdited, setActionStateEdited] = useState(false);
  const visibleActionStateValues = actionStateValues && !actionStateEdited ? actionStateValues : null;
  const [gender, setGender] = useState<InteractionAvatarGender>(() => interactionRoleAvatarGender(selectedRole?.avatarUrl));
  const allSeeds = useMemo(() => INTERACTION_AVATAR_SEEDS[gender], [gender]);
  const [selectedAvatar, setSelectedAvatar] = useState(
    () => actionStateValues?.avatarMode === "preset"
      ? actionStateValues.avatarUrl
      : selectedRole?.avatarUrl ?? interactionRoleAvatarUrl(INTERACTION_AVATAR_SEEDS.male[0] ?? DEFAULT_INTERACTION_AVATAR_SEED),
  );
  const [roleType, setRoleType] = useState(actionStateValues?.roleType ?? selectedPresentationRole);
  const [label, setLabel] = useState(
    actionStateValues?.label ?? selectedRole?.label ?? interactionRoleTypeLabel(selectedPresentationRole),
  );
  const [name, setName] = useState(actionStateValues?.name ?? selectedRole?.name ?? "");
  const [tone, setTone] = useState(
    actionStateValues?.tone ?? selectedRole?.tone ?? "溫和、清楚、像品牌官方小幫手，提醒優惠但不過度催促。",
  );
  const [isActive, setIsActive] = useState(actionStateValues?.isActive ?? selectedRole?.isActive ?? true);
  const [isScheduled, setIsScheduled] = useState(actionStateValues?.isScheduled ?? selectedRole?.isScheduled ?? false);
  const initialAvatarMode: InteractionRoleAvatarMode = actionStateValues?.avatarMode === "preset" || actionStateValues?.avatarMode === "custom"
    ? actionStateValues.avatarMode
    : selectedAvatarMode;
  const [avatarMode, setAvatarMode] = useState<InteractionRoleAvatarMode>(initialAvatarMode);
  const [customAvatarUrl, setCustomAvatarUrl] = useState(
    initialAvatarMode === "custom" ? actionStateValues?.avatarUrl ?? selectedRole?.avatarUrl ?? "" : "",
  );
  const [customAvatarAssetId, setCustomAvatarAssetId] = useState(
    initialAvatarMode === "custom" ? actionStateValues?.avatarAssetId ?? initialAvatarAssetId ?? "" : "",
  );
  const [avatarUploadBlocked, setAvatarUploadBlocked] = useState(false);
  const avatarHydrationKey = 0;
  const isEditing = Boolean(selectedRole);
  const displayedAvatarMode: InteractionRoleAvatarMode = visibleActionStateValues?.avatarMode === "preset" || visibleActionStateValues?.avatarMode === "custom"
    ? visibleActionStateValues.avatarMode
    : avatarMode;
  const displayedAvatarUrl = visibleActionStateValues?.avatarUrl ?? customAvatarUrl;
  const displayedSelectedAvatar = visibleActionStateValues?.avatarUrl ?? selectedAvatar;
  const displayedCustomAvatarAssetId = visibleActionStateValues?.avatarAssetId ?? customAvatarAssetId;
  const displayedName = visibleActionStateValues?.name ?? name;
  const displayedRoleType = normalizePresentationRole(visibleActionStateValues?.roleType || roleType);
  const displayedLabel = visibleActionStateValues?.label ?? label;
  const displayedTone = visibleActionStateValues?.tone ?? tone;
  const displayedIsActive = visibleActionStateValues?.isActive ?? isActive;
  const displayedSafeCustomAvatarUrl = parseSafeExternalHttpUrl(displayedAvatarUrl) ?? "";
  const displayedPreviewAvatarUrl = displayedAvatarMode === "custom"
    ? displayedSafeCustomAvatarUrl || interactionRoleAvatarUrl(DEFAULT_INTERACTION_AVATAR_SEED)
    : displayedSelectedAvatar;
  const previewName = displayedName.trim() || "未命名角色";
  const previewLabel = displayedLabel.trim() || interactionRoleTypeLabel(displayedRoleType);

  function shiftAvatar(direction: -1 | 1) {
    setActionStateEdited(true);
    setAvatarMode("preset");
    const currentIndex = allSeeds.findIndex((seed) => interactionRoleAvatarUrl(seed) === selectedAvatar);
    const nextIndex = ((currentIndex >= 0 ? currentIndex : 0) + direction + allSeeds.length) % allSeeds.length;
    setSelectedAvatar(interactionRoleAvatarUrl(allSeeds[nextIndex] ?? DEFAULT_INTERACTION_AVATAR_SEED));
  }

  function switchGender(nextGender: InteractionAvatarGender) {
    setActionStateEdited(true);
    setAvatarMode("preset");
    setGender(nextGender);
    setSelectedAvatar(interactionRoleAvatarUrl(INTERACTION_AVATAR_SEEDS[nextGender][0] ?? DEFAULT_INTERACTION_AVATAR_SEED));
  }

  function switchAvatarMode(nextMode: InteractionRoleAvatarMode) {
    setActionStateEdited(true);
    setAvatarMode(nextMode);
    if (nextMode === "preset" && !isCanonicalInteractionRolePresetUrl(selectedAvatar)) {
      setSelectedAvatar(interactionRoleAvatarUrl(INTERACTION_AVATAR_SEEDS.male[0] ?? DEFAULT_INTERACTION_AVATAR_SEED));
    }
  }

  function updateCustomAvatar(value: MediaUploadPersistedValue) {
    setActionStateEdited(true);
    setCustomAvatarUrl(value.url);
    setCustomAvatarAssetId(value.assetId);
  }

  function switchRoleType(nextType: string) {
    setActionStateEdited(true);
    setLabel((currentLabel) => interactionRoleLabelAfterTypeChange(currentLabel, roleType, nextType));
    setRoleType(nextType);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <aside className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-border bg-slate-50 p-4">
          <div>
            <h2 className="font-semibold text-slate-950">互動角色清單</h2>
            <p className="text-sm text-slate-500">{roles.length} 個互動角色</p>
          </div>
          <Link
            href="/interaction-roles/new"
            aria-label="新增互動角色"
            className="grid h-11 w-11 place-items-center rounded-md bg-primary text-white shadow-sm hover:bg-primary-dark"
          >
            <Plus size={17} aria-hidden="true" />
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
              <Plus size={18} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-950">新增互動角色</span>
              <span className="block text-xs text-slate-600">選頭像、輸入暱稱即可</span>
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
                  <span className="block truncate text-xs text-slate-600">{role.label} · {role.isActive ? "啟用" : "停用"}</span>
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
            <h2 className="mt-1 text-2xl font-bold">{isEditing ? "編輯互動角色" : "新增互動角色"}</h2>
          </div>
          <p className="text-sm text-blue-50">向量插畫頭像，不使用真實人臉照。</p>
        </div>

        <form
          action={formAction}
          aria-busy={pending}
          onSubmit={(event) => {
            const submitter = event.nativeEvent.submitter;
            const isDelete = submitter instanceof HTMLButtonElement && submitter.value === "delete";
            if (avatarUploadBlocked && !isDelete) event.preventDefault();
          }}
          className="grid gap-6 p-5"
        >
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          {selectedRole ? <input type="hidden" name="id" value={selectedRole.id} /> : null}
          <input type="hidden" name="avatarMode" value={displayedAvatarMode} />
          {displayedAvatarMode === "preset" ? (
            <>
              <input type="hidden" name="avatarUrl" value={displayedSelectedAvatar} />
              <input type="hidden" name="avatarAssetId" value="" />
              <input type="hidden" name="avatarUploadPhase" value="" />
            </>
          ) : null}

          {error === "invalid_role" ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              角色資料無效，請檢查暱稱、角色類型、標籤與語氣後再試一次。
            </p>
          ) : null}
          {error === "missing_role" ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              這個角色已不存在或不屬於目前商店，請從清單重新選擇或建立新角色。
            </p>
          ) : null}
          {actionState.status === "error" ? (
            <p role="alert" aria-live="assertive" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {actionState.message}
            </p>
          ) : null}

          {isLegacyRole ? (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
              這個角色原本使用舊角色類型「{interactionRoleTypeLabel(selectedRole?.roleType ?? "official")}」，目前以官方角色呈現；儲存後會轉為官方角色，不會再寫回舊類型。
            </p>
          ) : null}

          <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            互動角色會以商家預先設定的腳本出現在直播中；前台會明確標示。它不代表真人、即時留言、觀看人數、報名、訂單、付款、評論或成效。
          </p>

          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center shadow-inner">
              <div className="mb-4 flex justify-center rounded-lg bg-white p-1 shadow-sm">
                {(["preset", "custom"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => switchAvatarMode(item)}
                    aria-pressed={displayedAvatarMode === item}
                    className={`h-9 flex-1 rounded-md text-sm font-semibold transition ${
                      displayedAvatarMode === item ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {item === "preset" ? "預設頭像" : "上傳頭像"}
                  </button>
                ))}
              </div>

              {displayedAvatarMode === "preset" ? (
                <>
              <div className="mb-4 flex justify-center rounded-lg bg-white p-1 shadow-sm">
                {(["male", "female"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => switchGender(item)}
                    aria-pressed={gender === item}
                    className={`h-9 flex-1 rounded-md text-sm font-semibold transition ${
                      gender === item ? "bg-primary text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {item === "male" ? "男" : "女"}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => shiftAvatar(-1)}
                  aria-label="上一個頭像"
                  className="grid h-11 w-11 place-items-center rounded-full border border-border bg-white text-slate-600 shadow-sm hover:bg-slate-50"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <Image src={displayedSelectedAvatar} alt="目前選取頭像" width={150} height={150} unoptimized className="h-36 w-36 rounded-3xl bg-white p-3 shadow-lg" />
                <button
                  type="button"
                  onClick={() => shiftAvatar(1)}
                  aria-label="下一個頭像"
                  className="grid h-11 w-11 place-items-center rounded-full border border-border bg-white text-slate-600 shadow-sm hover:bg-slate-50"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-5 gap-2">
                {allSeeds.map((seed, index) => {
                  const url = interactionRoleAvatarUrl(seed);
                  return (
                    <button
                      key={seed}
                      type="button"
                      onClick={() => { setActionStateEdited(true); setSelectedAvatar(url); }}
                      aria-label={`選擇頭像 ${index + 1}`}
                      aria-pressed={selectedAvatar === url}
                      className={`rounded-xl border bg-white p-1 transition hover:-translate-y-0.5 hover:shadow-sm ${
                        selectedAvatar === url ? "border-blue-500 ring-2 ring-blue-100" : "border-slate-200"
                      }`}
                    >
                      <Image src={url} alt="" width={42} height={42} unoptimized className="aspect-square w-full rounded-lg" />
                    </button>
                  );
                })}
              </div>
                </>
              ) : (
                <div className="grid gap-3 text-left">
                  <MediaUploadField
                    key={avatarHydrationKey}
                    kind="image"
                    label="角色頭像"
                    description="直接上傳角色頭像；完成後儲存表單即可套用。"
                    defaultUrl={displayedSafeCustomAvatarUrl}
                    defaultAssetId={displayedCustomAvatarAssetId}
                    urlInputName="avatarUrl"
                    assetIdInputName="avatarAssetId"
                    statusInputName="avatarUploadPhase"
                    allowExternalUrlFallback
                    hydrationKey={avatarHydrationKey}
                    onValueChange={updateCustomAvatar}
                    onBlockingChange={setAvatarUploadBlocked}
                  />
                  {avatarUploadBlocked ? (
                    <p role="alert" aria-live="assertive" className="rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      頭像上傳尚未完成，請完成上傳或移除未完成的檔案後再儲存。
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                暱稱
                <input name="name" required maxLength={160} value={displayedName} onChange={(event) => { setActionStateEdited(true); setName(event.target.value); }} placeholder="例如：直播小編" className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  角色類型
                  <select name="roleType" value={displayedRoleType} onChange={(event) => switchRoleType(event.target.value)} className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100">
                    <option value="official">官方角色</option>
                    <option value="audience">一般觀眾</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  顯示標籤
                  <input name="label" required maxLength={80} value={displayedLabel} onChange={(event) => { setActionStateEdited(true); setLabel(event.target.value); }} className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
                </label>
              </div>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                語氣設定
                <textarea name="tone" maxLength={500} value={displayedTone} onChange={(event) => { setActionStateEdited(true); setTone(event.target.value); }} rows={4} className="rounded-md border border-border px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input name="isActive" type="checkbox" checked={displayedIsActive} onChange={(event) => { setActionStateEdited(true); setIsActive(event.target.checked); }} className="h-4 w-4 accent-blue-600" />
                啟用角色
              </label>
              <label className="flex items-start gap-2 text-sm font-medium text-slate-700">
                <input name="isScheduled" type="checkbox" value="true" checked={visibleActionStateValues?.isScheduled ?? isScheduled} onChange={(event) => { setActionStateEdited(true); setIsScheduled(event.target.checked); }} className="mt-0.5 h-4 w-4 accent-violet-600" />
                <span>
                  <span className="block">排程角色</span>
                  <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">標記此角色供直播排程與後續分析辨識；前台呈現與數據排除將在直播互動流程完成後生效。</span>
                </span>
              </label>
            </div>
          </div>

          <InteractionRolePreview
            avatarUrl={displayedPreviewAvatarUrl}
            name={previewName}
            label={previewLabel}
            tone={displayedTone.trim()}
            isActive={displayedIsActive}
            presentationRole={displayedRoleType}
            isScheduled={visibleActionStateValues?.isScheduled ?? isScheduled}
          />

          {selectedRole ? <InteractionRoleUsageImpact roleUsage={roleUsage} isActive={isActive} /> : null}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            {selectedRole ? (
              <FormSubmitButton
                formAction={deleteInteractionRoleAction}
                name="intent"
                value="delete"
                formNoValidate
                confirmMessage={`確定刪除「${selectedRole.name}」？${roleUsage.length > 0 ? `目前有 ${roleUsage.length} 個腳本引用；` : ""}既有事件中的角色會改顯示為官方系統。`}
                pendingChildren={<>刪除中…</>}
                pendingMessage="正在刪除互動角色"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                <Trash2 size={16} aria-hidden="true" />
                刪除
              </FormSubmitButton>
            ) : null}
            <FormSubmitButton
              disabled={avatarUploadBlocked}
              pendingChildren={<>儲存中…</>}
              pendingMessage={selectedRole ? "正在儲存互動角色" : "正在新增互動角色"}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
            >
              {selectedRole ? <Save size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              {selectedRole ? "儲存" : "新增"}
            </FormSubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}
