"use client";

import Image from "next/image";
import { useMemo, useState, type DragEvent, type FormEvent, type MouseEvent } from "react";
import type { InteractionEvent, InteractionRole, InteractionScript, Live, Product, Video } from "@prisma/client";
import { BadgeCheck, ChevronDown, ChevronUp, GripVertical, Link2Off, Plus, Trash2, VideoIcon } from "lucide-react";
import { unbindInteractionScriptFromLiveAction, upsertInteractionScriptAction } from "@/app/actions";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import {
  INTERACTION_TIME_FORMAT_ERROR,
  parseInteractionTriggerSeconds,
  reorderInteractionEvents,
} from "@/lib/interaction-timeline";

type ScriptWithEvents = InteractionScript & {
  events: InteractionEvent[];
};

type BoundLive = Live & {
  video: Video | null;
};

type TimelineEvent = Pick<InteractionEvent, "eventType" | "triggerSec" | "title"> &
  Partial<Pick<InteractionEvent, "message" | "roleId" | "productId" | "ctaLabel" | "ctaUrl">>;

type TimelineTemplate = {
  name: string;
  description: string;
  events: TimelineEvent[];
};

const timelineTemplates: TimelineTemplate[] = [
  {
    name: "新品快閃",
    description: "短時間快速推商品與 CTA。",
    events: [
      { eventType: "chat_message", triggerSec: 5, title: "開場", message: "歡迎來到官方直播間，今天會快速整理新品亮點。" },
      { eventType: "chat_message", triggerSec: 45, title: "主打商品", message: "主打組合已經浮出，想比較規格可以先點商品卡。" },
      { eventType: "chat_message", triggerSec: 90, title: "使用情境", message: "第一次接觸可以先從體驗組開始，門檻比較輕。" },
      { eventType: "chat_message", triggerSec: 180, title: "優惠提醒", message: "直播限定優惠已開放，等等會整理完整連結。" },
    ],
  },
  {
    name: "保養導購",
    description: "教育、比較、加購推薦。",
    events: [
      { eventType: "chat_message", triggerSec: 10, title: "主持人開場", message: "今天會依膚況拆解三種搭配，官方角色會整理重點。" },
      { eventType: "chat_message", triggerSec: 120, title: "痛點鋪陳", message: "如果換季容易乾、妝不服貼，可以注意接下來的修護組合。" },
      { eventType: "chat_message", triggerSec: 240, title: "修護組", message: "修護組適合想快速補水與穩定膚況的人。" },
      { eventType: "chat_message", triggerSec: 480, title: "報名提醒", message: "想收到優惠提醒，可以先到報名分頁留下資料。" },
      { eventType: "chat_message", triggerSec: 780, title: "旅行組", message: "旅行組比較適合第一次體驗或加購送人。" },
    ],
  },
  {
    name: "清倉限時",
    description: "庫存、倒數、高節奏 CTA。",
    events: [
      { eventType: "chat_message", triggerSec: 5, title: "規則", message: "這場是限量清倉，官方助手會標示組合與庫存提醒。" },
      { eventType: "chat_message", triggerSec: 30, title: "第一波", message: "第一波商品已經放上來，數量比較少，建議先加入比較。" },
      { eventType: "chat_message", triggerSec: 150, title: "第一波 CTA", message: "第一波優惠連結已更新，可以直接從商品卡進去。" },
      { eventType: "chat_message", triggerSec: 300, title: "庫存提醒", message: "目前主打組合是本場最划算的一組，售完後不一定會補。" },
    ],
  },
];

function secondsToClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainSeconds = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainSeconds).padStart(2, "0")}`;
}

function messageText(event: TimelineEvent) {
  return event.message ?? event.ctaLabel ?? event.title ?? "";
}

export function InteractionScriptForm({
  script,
  roles,
  boundLives = [],
  csrfToken,
  error,
}: {
  script?: ScriptWithEvents;
  roles: InteractionRole[];
  products: Product[];
  boundLives?: BoundLive[];
  csrfToken: string;
  error?: string;
}) {
  const initialEvents = useMemo<TimelineEvent[]>(() => (script?.events.length ? script.events : timelineTemplates[1].events), [script]);
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [timeInputs, setTimeInputs] = useState(() => initialEvents.map((event) => secondsToClock(event.triggerSec)));
  const [timeErrors, setTimeErrors] = useState<Record<number, string>>({});
  const [draggedEventIndex, setDraggedEventIndex] = useState<number | null>(null);
  const primaryLive = boundLives[0];

  function applyTemplate(template: TimelineTemplate) {
    setEvents(template.events);
    setTimeInputs(template.events.map((event) => secondsToClock(event.triggerSec)));
    setTimeErrors({});
  }

  function updateEvent(index: number, patch: Partial<TimelineEvent>) {
    setEvents((current) => current.map((event, eventIndex) => (eventIndex === index ? { ...event, ...patch } : event)));
  }

  function addEvent() {
    setEvents((current) => [
      {
        eventType: "chat_message",
        triggerSec: 0,
        title: "新留言",
        message: "",
        roleId: roles[0]?.id,
      },
      ...current,
    ]);
    setTimeInputs((current) => [secondsToClock(0), ...current]);
    setTimeErrors((current) => Object.fromEntries(Object.entries(current).map(([index, message]) => [Number(index) + 1, message])));
  }

  function removeEvent(index: number) {
    setEvents((current) => current.filter((_, eventIndex) => eventIndex !== index));
    setTimeInputs((current) => current.filter((_, inputIndex) => inputIndex !== index));
    setTimeErrors((current) => Object.fromEntries(Object.entries(current)
      .filter(([errorIndex]) => Number(errorIndex) !== index)
      .map(([errorIndex, message]) => [Number(errorIndex) > index ? Number(errorIndex) - 1 : Number(errorIndex), message])));
  }

  function moveEvent(fromIndex: number, toIndex: number) {
    setEvents((current) => {
      const reordered = reorderInteractionEvents(current, fromIndex, toIndex);
      setTimeInputs(reordered.map((event) => secondsToClock(event.triggerSec)));
      setTimeErrors({});
      return reordered;
    });
  }

  function updateTimeInput(index: number, value: string) {
    setTimeInputs((current) => current.map((timeInput, inputIndex) => (inputIndex === index ? value : timeInput)));
    const triggerSec = parseInteractionTriggerSeconds(value);
    if (triggerSec === null) {
      setTimeErrors((current) => ({ ...current, [index]: INTERACTION_TIME_FORMAT_ERROR }));
      return;
    }

    setTimeErrors((current) => {
      const remainingErrors = { ...current };
      delete remainingErrors[index];
      return remainingErrors;
    });
    updateEvent(index, { triggerSec });
  }

  function validateTimeInputs(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.dataset.intent === "unbind-live") return;

    const errors = Object.fromEntries(timeInputs
      .map((timeInput, index) => [index, parseInteractionTriggerSeconds(timeInput)] as const)
      .filter(([, triggerSec]) => triggerSec === null)
      .map(([index]) => [index, INTERACTION_TIME_FORMAT_ERROR]));
    setTimeErrors(errors);
    if (Object.keys(errors).length > 0) event.preventDefault();
  }

  function confirmUnbind(event: MouseEvent<HTMLButtonElement>, live: BoundLive) {
    if (!window.confirm(`確定要解除「${live.title}」與此留言組的綁定嗎？`)) event.preventDefault();
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, index: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggedEventIndex(index);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, targetIndex: number) {
    event.preventDefault();
    const sourceIndex = draggedEventIndex ?? Number.parseInt(event.dataTransfer.getData("text/plain"), 10);
    if (Number.isInteger(sourceIndex)) moveEvent(sourceIndex, targetIndex);
    setDraggedEventIndex(null);
  }

  return (
    <form action={upsertInteractionScriptAction} onSubmit={validateTimeInputs} className="grid gap-5">
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      {error === "invalid_reference" ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          互動事件引用的角色或商品無效，請重新選擇目前商店的資料。
        </p>
      ) : null}
      {script ? <input type="hidden" name="id" value={script.id} /> : null}
      <input type="hidden" name="status" value={script?.status ?? "published"} />
      <input type="hidden" name="description" value={script?.description ?? "留言組快速編輯"} />

      <section className="sticky top-0 z-20 rounded-xl border border-border bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            留言組名稱
            <input name="name" required defaultValue={script?.name ?? "保養導購留言組"} className="h-11 rounded-md border border-border px-3 text-base font-semibold text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
          </label>
          <button className="mt-auto inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark">
            更新留言組
          </button>
        </div>
      </section>

      {!script ? (
        <section className="grid gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">常見留言組範本</h2>
              <p className="mt-1 text-sm text-slate-500">先套用，再在右側清單快速調整。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {timelineTemplates.map((template) => (
                <button key={template.name} type="button" onClick={() => applyTemplate(template)} className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 text-sm font-semibold text-blue-700 hover:bg-blue-100">
                  <BadgeCheck size={14} />
                  {template.name}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <aside className="xl:sticky xl:top-[112px] xl:h-[calc(100vh-132px)]">
          <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-border bg-slate-50 p-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">綁定影片</p>
                <p className="text-xs text-slate-500">左側固定，不跟右側留言一起滾動。</p>
              </div>
              {boundLives.length > 0 ? <span className="text-xs font-medium text-slate-500">已綁定 {boundLives.length} 場直播</span> : null}
            </div>

            <div className="relative aspect-video bg-slate-900">
              {primaryLive?.video?.thumbnailUrl ? (
                <Image src={primaryLive.video.thumbnailUrl} alt="" fill unoptimized className="object-cover" />
              ) : (
                <div className="grid h-full place-items-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-800 text-white">
                  <VideoIcon size={34} />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-3 left-3 right-3 text-white">
                <p className="text-xs font-semibold text-white/70">綁定直播</p>
                <h2 className="line-clamp-1 font-bold">{primaryLive?.title ?? "尚未綁定直播"}</h2>
                <p className="line-clamp-1 text-xs text-white/70">{primaryLive?.video?.title ?? "可在直播間編輯頁綁定"}</p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {boundLives.length > 0 ? (
                <div className="mb-5 grid gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">目前綁定的直播</h3>
                  {boundLives.map((live) => (
                    <div key={live.id} data-testid="bound-live" className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                      <p className="min-w-0 truncate text-sm font-medium text-slate-700">{live.title}</p>
                      <button
                        type="submit"
                        name="liveId"
                        value={live.id}
                        data-intent="unbind-live"
                        formAction={unbindInteractionScriptFromLiveAction}
                        formNoValidate
                        onClick={(event) => confirmUnbind(event, live)}
                        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-red-100 bg-white px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        <Link2Off size={14} />
                        解除綁定影片
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <h3 className="mb-3 text-sm font-semibold text-slate-950">時間點大綱</h3>
              <div data-testid="interaction-timeline-outline" className="grid gap-2">
                {events
                  .map((event, index) => ({ event, index }))
                  .map(({ event, index }) => (
                    <div key={`${event.title}-${index}`} data-testid="interaction-timeline-outline-item" className="grid grid-cols-[84px_1fr] gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-sm">
                      <span data-testid="interaction-timeline-outline-time" className="rounded-md bg-blue-600 px-2 py-1 text-center font-mono text-xs font-bold text-white">{secondsToClock(event.triggerSec)}</span>
                      <span data-testid="interaction-timeline-outline-message" className="line-clamp-1 font-medium text-slate-700">{messageText(event) || event.title}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </aside>

        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border bg-slate-50 p-4">
            <div>
              <h2 className="font-semibold text-slate-950">留言清單</h2>
              <p className="text-sm text-slate-500">最新新增的留言會出現在最上方。</p>
            </div>
            <button type="button" onClick={addEvent} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark">
              <Plus size={16} />
              新增留言
            </button>
          </div>

          <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
            <div className="grid grid-cols-[112px_64px_1fr_auto] gap-2 border-b border-border bg-white px-4 py-3 text-xs font-bold uppercase text-slate-400">
              <span>時間</span>
              <span>角色</span>
              <span>留言內容</span>
              <span />
            </div>
            <div data-testid="interaction-message-list" className="divide-y divide-slate-100">
              {events.map((event, index) => {
                const selectedRole = roles.find((role) => role.id === event.roleId) ?? roles[0];
                const selectedAvatar = selectedRole?.avatarUrl;
                return (
                  <div
                    key={`${event.eventType}-${index}`}
                    data-testid="interaction-message-row"
                    draggable
                    onDragStart={(dragEvent) => handleDragStart(dragEvent, index)}
                    onDragOver={(dragEvent) => dragEvent.preventDefault()}
                    onDrop={(dragEvent) => handleDrop(dragEvent, index)}
                    onDragEnd={() => setDraggedEventIndex(null)}
                    className={`grid grid-cols-[112px_64px_1fr_auto] gap-2 px-4 py-2 hover:bg-blue-50/40 ${draggedEventIndex === index ? "opacity-50" : ""}`}
                  >
                    <div className="grid gap-1">
                      <input
                        data-testid="interaction-message-time"
                        name="triggerSec"
                        value={timeInputs[index] ?? secondsToClock(event.triggerSec)}
                        onChange={(inputEvent) => updateTimeInput(index, inputEvent.target.value)}
                        aria-describedby={timeErrors[index] ? `triggerSec-error-${index}` : undefined}
                        aria-invalid={Boolean(timeErrors[index])}
                        className="h-10 rounded-md border border-border px-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
                      />
                      {timeErrors[index] ? <p id={`triggerSec-error-${index}`} className="text-xs leading-4 text-red-600">{timeErrors[index]}</p> : null}
                    </div>
                    <div className="relative grid h-10 w-10 place-items-center rounded-full bg-slate-100">
                      {selectedAvatar ? <Image src={selectedAvatar} alt="" width={40} height={40} unoptimized className="h-10 w-10 rounded-full object-cover" /> : null}
                      <select name="roleId" value={event.roleId ?? selectedRole?.id ?? ""} onChange={(selectEvent) => updateEvent(index, { roleId: selectEvent.target.value || null })} className="absolute inset-0 cursor-pointer opacity-0">
                        <option value="">不指定</option>
                        {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <input type="hidden" name="eventType" value={event.eventType || "chat_message"} />
                      <input type="hidden" name="eventTitle" value={event.title || messageText(event) || "留言"} />
                      <input type="hidden" name="productId" value={event.productId ?? ""} />
                      <input type="hidden" name="ctaLabel" value={event.ctaLabel ?? ""} />
                      <input type="hidden" name="ctaUrl" value={event.ctaUrl ?? ""} />
                      <textarea
                        data-testid="interaction-message-content"
                        name="message"
                        value={messageText(event)}
                        onChange={(inputEvent) => updateEvent(index, { message: inputEvent.target.value, title: inputEvent.target.value.slice(0, 24) || "留言" })}
                        rows={1}
                        className="min-h-10 w-full resize-y rounded-md border border-border px-3 py-2 text-sm leading-5 outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
                        placeholder="輸入留言內容"
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="grid h-10 w-5 cursor-grab place-items-center text-slate-400 active:cursor-grabbing" aria-hidden="true">
                        <GripVertical size={16} />
                      </span>
                      <button
                        type="button"
                        onClick={() => moveEvent(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`將第 ${index + 1} 則留言上移`}
                        className="grid h-10 w-8 place-items-center rounded-md border border-border text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronUp size={16} />
                        <span className="sr-only">上移</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => moveEvent(index, index + 1)}
                        disabled={index === events.length - 1}
                        aria-label={`將第 ${index + 1} 則留言下移`}
                        className="grid h-10 w-8 place-items-center rounded-md border border-border text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ChevronDown size={16} />
                        <span className="sr-only">下移</span>
                      </button>
                      <button type="button" onClick={() => removeEvent(index)} aria-label={`刪除第 ${index + 1} 則留言`} className="grid h-10 w-10 place-items-center rounded-md border border-red-100 text-red-500 hover:bg-red-50">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </form>
  );
}
