"use client";

import Image from "next/image";
import { useMemo, useState, type DragEvent, type FormEvent, type MouseEvent } from "react";
import type { InteractionEvent, InteractionRole, InteractionScript, Live, Product, Video } from "@prisma/client";
import { BadgeCheck, ChevronDown, ChevronUp, GripVertical, Link2Off, MessageCircle, Megaphone, ShoppingBag, Trash2, VideoIcon } from "lucide-react";
import { unbindInteractionScriptFromLiveAction } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import {
  INTERACTION_EVENT_TYPES,
  interactionEventTypeLabel,
  normalizeInteractionEventDraft,
  type InteractionEventType,
} from "@/lib/interaction-event";
import {
  INTERACTION_TIME_FORMAT_ERROR,
  parseInteractionTriggerSeconds,
  reorderInteractionEvents,
} from "@/lib/interaction-timeline";
import { normalizePresentationRole } from "@/lib/interaction-role";

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
      { eventType: "product_spotlight", triggerSec: 45, title: "主打商品" },
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
      { eventType: "product_spotlight", triggerSec: 240, title: "修護組" },
      { eventType: "chat_message", triggerSec: 480, title: "報名提醒", message: "想收到優惠提醒，可以先到報名分頁留下資料。" },
      { eventType: "chat_message", triggerSec: 780, title: "旅行組", message: "旅行組比較適合第一次體驗或加購送人。" },
    ],
  },
  {
    name: "清倉限時",
    description: "庫存、倒數、高節奏 CTA。",
    events: [
      { eventType: "chat_message", triggerSec: 5, title: "規則", message: "這場是限量清倉，官方助手會標示組合與庫存提醒。" },
      { eventType: "product_spotlight", triggerSec: 30, title: "第一波商品" },
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

function eventSummary(event: TimelineEvent, products: Product[]) {
  if (event.eventType === "product_spotlight") {
    return products.find((product) => product.id === event.productId)?.name ?? "尚未選擇商品";
  }
  if (event.eventType === "cta_switch") return event.ctaLabel || "尚未設定 CTA";
  return event.message || event.title || "尚未輸入訊息";
}

function initialTimelineEvents(
  script: ScriptWithEvents | undefined,
  roles: InteractionRole[],
  products: Product[],
): TimelineEvent[] {
  if (script?.events.length) return script.events;
  const templateEvents = timelineTemplates[1]?.events ?? timelineTemplates[0]?.events ?? [];
  return templateEvents.flatMap((event) => {
    if (event.eventType === "product_spotlight" && !products[0]) return [];
    return [{
      ...event,
      roleId: event.eventType === "chat_message" || event.eventType === "reminder" ? roles[0]?.id ?? null : null,
      productId: event.eventType === "product_spotlight" ? products[0]?.id : null,
    }];
  });
}

function scheduledRolesOnly(roles: InteractionRole[]) {
  return roles.filter((role) => {
    if (!role.isActive || !role.isScheduled) return false;
    try {
      normalizePresentationRole(role.roleType);
      return true;
    } catch {
      return false;
    }
  });
}

function renderTimelineSidebar({
  boundLives,
  primaryLive,
  events,
  products,
  confirmUnbind,
}: {
  boundLives: BoundLive[];
  primaryLive: BoundLive | undefined;
  events: TimelineEvent[];
  products: Product[];
  confirmUnbind: (event: MouseEvent<HTMLButtonElement>, live: BoundLive) => void;
}) {
  return (
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

        <div
          role="region"
          aria-label="綁定影片與時間點大綱"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          {boundLives.length > 0 ? (
            <div className="mb-5 grid gap-2">
              <h3 className="text-sm font-semibold text-slate-950">目前綁定的直播</h3>
              {boundLives.map((live) => (
                <div key={live.id} data-testid="bound-live" className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                  <p className="min-w-0 truncate text-sm font-medium text-slate-700">{live.title}</p>
                  <FormSubmitButton
                    type="submit"
                    name="liveId"
                    value={live.id}
                    data-intent="unbind-live"
                    formAction={unbindInteractionScriptFromLiveAction}
                    formNoValidate
                    onClick={(event) => confirmUnbind(event, live)}
                    pendingChildren="解除中…"
                    pendingMessage={`正在解除「${live.title}」與互動腳本的綁定。`}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-red-100 bg-white px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    <Link2Off size={14} />
                    解除綁定影片
                  </FormSubmitButton>
                </div>
              ))}
            </div>
          ) : null}
          <h3 className="mb-3 text-sm font-semibold text-slate-950">時間點大綱</h3>
          <div data-testid="interaction-timeline-outline" className="grid gap-2">
            {events.map((event, index) => (
              <div key={`${event.title}-${index}`} data-testid="interaction-timeline-outline-item" className="grid grid-cols-[84px_1fr] gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-sm">
                <span data-testid="interaction-timeline-outline-time" className="rounded-md bg-blue-600 px-2 py-1 text-center font-mono text-xs font-bold text-white">{secondsToClock(event.triggerSec)}</span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold text-blue-700">{interactionEventTypeLabel(event.eventType)}</span>
                  <span data-testid="interaction-timeline-outline-message" className="block truncate font-medium text-slate-700">{eventSummary(event, products)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function renderInteractionEventRow({
  event,
  index,
  eventCount,
  roles,
  products,
  timeInput,
  timeError,
  eventError,
  isDragged,
  updateEvent,
  updateTimeInput,
  changeEventType,
  moveEvent,
  removeEvent,
  handleDragStart,
  handleDrop,
  finishDrag,
}: {
  event: TimelineEvent;
  index: number;
  eventCount: number;
  roles: InteractionRole[];
  products: Product[];
  timeInput: string | undefined;
  timeError: string | undefined;
  eventError: string | undefined;
  isDragged: boolean;
  updateEvent: (index: number, patch: Partial<TimelineEvent>) => void;
  updateTimeInput: (index: number, value: string) => void;
  changeEventType: (index: number, eventType: InteractionEventType) => void;
  moveEvent: (fromIndex: number, toIndex: number) => void;
  removeEvent: (index: number) => void;
  handleDragStart: (event: DragEvent<HTMLElement>, index: number) => void;
  handleDrop: (event: DragEvent<HTMLElement>, targetIndex: number) => void;
  finishDrag: () => void;
}) {
  const isMessageEvent = event.eventType === "chat_message" || event.eventType === "reminder";
  const selectedRole = roles.find((role) => role.id === event.roleId);
  const invalidRoleReference = isMessageEvent && Boolean(event.roleId) && !selectedRole;
  const selectedProduct = products.find((product) => product.id === event.productId) ?? products[0];

  return (
    <article
      key={`${event.eventType}-${index}`}
      data-testid="interaction-message-row"
      draggable
      onDragStart={(dragEvent) => handleDragStart(dragEvent, index)}
      onDragOver={(dragEvent) => dragEvent.preventDefault()}
      onDrop={(dragEvent) => handleDrop(dragEvent, index)}
      onDragEnd={finishDrag}
      className={`grid gap-3 px-4 py-4 lg:grid-cols-[112px_160px_minmax(0,1fr)_auto] lg:items-start ${isDragged ? "opacity-50" : ""}`}
    >
      <div className="grid gap-1">
        <label className="text-xs font-semibold text-slate-600" htmlFor={`triggerSec-${index}`}>觸發時間</label>
        <input
          id={`triggerSec-${index}`}
          data-testid="interaction-message-time"
          name="triggerSec"
          value={timeInput ?? secondsToClock(event.triggerSec)}
          onChange={(inputEvent) => updateTimeInput(index, inputEvent.target.value)}
          aria-label={`第 ${index + 1} 個事件時間`}
          aria-describedby={timeError ? `triggerSec-error-${index}` : undefined}
          aria-invalid={Boolean(timeError)}
          className="h-11 rounded-md border border-border px-2 font-mono text-xs outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
        />
        {timeError ? <p id={`triggerSec-error-${index}`} className="text-xs leading-4 text-red-600">{timeError}</p> : null}
      </div>

      <label className="grid gap-1 text-xs font-semibold text-slate-600">
        事件類型
        <select
          name="eventType"
          value={event.eventType}
          onChange={(selectEvent) => changeEventType(index, selectEvent.target.value as InteractionEventType)}
          className="h-11 rounded-md border border-border bg-white px-2 text-sm font-semibold text-slate-800 outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
        >
          {INTERACTION_EVENT_TYPES.map((eventType) => (
            <option key={eventType} value={eventType}>{interactionEventTypeLabel(eventType)}</option>
          ))}
        </select>
      </label>

      <div className="grid gap-3">
        <input type="hidden" name="eventTitle" value={event.title || eventSummary(event, products)} />
        {isMessageEvent ? (
          <>
            <div className="grid gap-2 sm:grid-cols-[minmax(150px,0.45fr)_1fr]">
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                排程角色
                <span className="flex items-center gap-2">
                  {selectedRole?.avatarUrl ? <Image src={selectedRole.avatarUrl} alt="" width={32} height={32} unoptimized className="h-8 w-8 rounded-full object-cover" /> : null}
                  <select
                    name="roleId"
                    value={selectedRole?.id ?? ""}
                    onChange={(selectEvent) => updateEvent(index, { roleId: selectEvent.target.value || null })}
                    aria-label={`第 ${index + 1} 個事件角色`}
                    aria-invalid={invalidRoleReference || !selectedRole}
                    required
                    className="h-11 min-w-0 flex-1 rounded-md border border-border bg-white px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="">{invalidRoleReference ? "原角色無效，請重新選擇" : "請選擇排程角色"}</option>
                    {roles.map((role) => <option key={role.id} value={role.id}>{role.name} · {role.label}</option>)}
                  </select>
                </span>
              </label>
              {invalidRoleReference ? <p role="alert" className="text-xs font-medium text-amber-700">此事件原本引用的角色目前無法使用，請重新選擇排程角色。</p> : null}
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                訊息內容
                <textarea
                  data-testid="interaction-message-content"
                  name="message"
                  value={event.message ?? ""}
                  onChange={(inputEvent) => updateEvent(index, { message: inputEvent.target.value, title: inputEvent.target.value.slice(0, 60) || interactionEventTypeLabel(event.eventType) })}
                  aria-label={`第 ${index + 1} 個事件訊息內容`}
                  aria-describedby={eventError ? `event-error-${index}` : undefined}
                  aria-invalid={Boolean(eventError)}
                  maxLength={1000}
                  rows={2}
                  required
                  className="min-h-11 w-full resize-y rounded-md border border-border px-3 py-2 text-sm leading-5 outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
                  placeholder="輸入會公開顯示的排程訊息"
                />
              </label>
            </div>
            <input type="hidden" name="productId" value="" />
            <input type="hidden" name="ctaLabel" value="" />
            <input type="hidden" name="ctaUrl" value="" />
          </>
        ) : event.eventType === "product_spotlight" ? (
          <>
            <input type="hidden" name="roleId" value="" />
            <input type="hidden" name="message" value="" />
            <label className="grid gap-1 text-xs font-semibold text-slate-600">
              要浮出的商品
              <select
                name="productId"
                value={products.some((product) => product.id === event.productId) ? event.productId ?? "" : selectedProduct?.id ?? ""}
                onChange={(selectEvent) => {
                  const product = products.find((item) => item.id === selectEvent.target.value);
                  updateEvent(index, { productId: selectEvent.target.value || null, title: product ? `商品：${product.name}` : "商品聚焦" });
                }}
                aria-describedby={eventError ? `event-error-${index}` : undefined}
                aria-invalid={Boolean(eventError)}
                required
                className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
              >
                <option value="">請選擇商品</option>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </label>
            <input type="hidden" name="ctaLabel" value="" />
            <input type="hidden" name="ctaUrl" value="" />
          </>
        ) : (
          <>
            <input type="hidden" name="roleId" value="" />
            <input type="hidden" name="message" value="" />
            <input type="hidden" name="productId" value="" />
            <div className="grid gap-2 sm:grid-cols-[0.4fr_1fr]">
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                CTA 文字
                <input
                  name="ctaLabel"
                  value={event.ctaLabel ?? ""}
                  onChange={(inputEvent) => updateEvent(index, { ctaLabel: inputEvent.target.value, title: inputEvent.target.value.slice(0, 120) || "CTA 切換" })}
                  maxLength={120}
                  required
                  className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
                  placeholder="例如：查看直播優惠"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-600">
                安全連結（完整 HTTPS 網址）
                <input
                  name="ctaUrl"
                  type="url"
                  inputMode="url"
                  value={event.ctaUrl ?? ""}
                  onChange={(inputEvent) => updateEvent(index, { ctaUrl: inputEvent.target.value })}
                  aria-describedby={eventError ? `event-error-${index}` : undefined}
                  aria-invalid={Boolean(eventError)}
                  maxLength={2048}
                  required
                  className="h-11 rounded-md border border-border px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100"
                  placeholder="https://shop.example.com/deal"
                />
              </label>
            </div>
          </>
        )}
        {eventError ? <p id={`event-error-${index}`} role="alert" className="text-xs font-medium text-red-600">{eventError}</p> : null}
      </div>

      <div className="flex items-center justify-end gap-1">
        <span className="grid h-11 w-6 cursor-grab place-items-center text-slate-400 active:cursor-grabbing" aria-hidden="true">
          <GripVertical size={16} />
        </span>
        <button type="button" onClick={() => moveEvent(index, index - 1)} disabled={index === 0} aria-label={`將第 ${index + 1} 個事件上移`} className="grid h-11 w-9 place-items-center rounded-md border border-border text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronUp size={16} />
        </button>
        <button type="button" onClick={() => moveEvent(index, index + 1)} disabled={index === eventCount - 1} aria-label={`將第 ${index + 1} 個事件下移`} className="grid h-11 w-9 place-items-center rounded-md border border-border text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
          <ChevronDown size={16} />
        </button>
        <button type="button" onClick={() => removeEvent(index)} aria-label={`刪除第 ${index + 1} 個事件`} className="grid h-11 w-11 place-items-center rounded-md border border-red-100 text-red-600 hover:bg-red-50">
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

export function InteractionScriptForm({
  script,
  roles,
  products,
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
  const availableRoles = useMemo(() => scheduledRolesOnly(roles), [roles]);
  const initialEvents = useMemo(() => initialTimelineEvents(script, availableRoles, products), [availableRoles, products, script]);
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents);
  const [timeInputs, setTimeInputs] = useState(() => initialEvents.map((event) => secondsToClock(event.triggerSec)));
  const [timeErrors, setTimeErrors] = useState<Record<number, string>>({});
  const [eventErrors, setEventErrors] = useState<Record<number, string>>({});
  const [draggedEventIndex, setDraggedEventIndex] = useState<number | null>(null);
  const primaryLive = boundLives[0];

  function applyTemplate(template: TimelineTemplate) {
    const nextEvents = template.events.flatMap((event) => {
      if (event.eventType === "product_spotlight" && !products[0]) return [];
      return [{
        ...event,
        roleId: event.eventType === "chat_message" || event.eventType === "reminder" ? availableRoles[0]?.id ?? null : null,
        productId: event.eventType === "product_spotlight" ? products[0]?.id : null,
      }];
    });
    setEvents(nextEvents);
    setTimeInputs(nextEvents.map((event) => secondsToClock(event.triggerSec)));
    setTimeErrors({});
    setEventErrors({});
  }

  function updateEvent(index: number, patch: Partial<TimelineEvent>) {
    setEvents((current) => current.map((event, eventIndex) => (eventIndex === index ? { ...event, ...patch } : event)));
    setEventErrors((current) => {
      const remainingErrors = { ...current };
      delete remainingErrors[index];
      return remainingErrors;
    });
  }

  function addEvent(eventType: InteractionEventType) {
    const event: TimelineEvent = eventType === "product_spotlight"
      ? { eventType, triggerSec: 0, title: "商品聚焦", productId: products[0]?.id }
      : eventType === "cta_switch"
        ? { eventType, triggerSec: 0, title: "查看優惠", ctaLabel: "查看優惠", ctaUrl: "" }
        : { eventType, triggerSec: 0, title: eventType === "reminder" ? "新提醒" : "新留言", message: "", roleId: availableRoles[0]?.id ?? null };
    setEvents((current) => [
      event,
      ...current,
    ]);
    setTimeInputs((current) => [secondsToClock(0), ...current]);
    setTimeErrors((current) => Object.fromEntries(Object.entries(current).map(([index, message]) => [Number(index) + 1, message])));
    setEventErrors((current) => Object.fromEntries(Object.entries(current).map(([index, message]) => [Number(index) + 1, message])));
  }

  function changeEventType(index: number, eventType: InteractionEventType) {
    const current = events[index];
    updateEvent(index, eventType === "product_spotlight"
      ? { eventType, title: "商品聚焦", message: null, roleId: null, productId: products[0]?.id, ctaLabel: null, ctaUrl: null }
      : eventType === "cta_switch"
        ? { eventType, title: "查看優惠", message: null, roleId: null, productId: null, ctaLabel: "查看優惠", ctaUrl: "" }
        : {
            eventType,
            title: eventType === "reminder" ? "提醒" : "官方留言",
            message: current?.message ?? "",
            roleId: current?.roleId ?? availableRoles[0]?.id ?? null,
            productId: null,
            ctaLabel: null,
            ctaUrl: null,
          });
  }

  function removeEvent(index: number) {
    setEvents((current) => current.filter((_, eventIndex) => eventIndex !== index));
    setTimeInputs((current) => current.filter((_, inputIndex) => inputIndex !== index));
    setTimeErrors((current) => Object.fromEntries(Object.entries(current)
      .filter(([errorIndex]) => Number(errorIndex) !== index)
      .map(([errorIndex, message]) => [Number(errorIndex) > index ? Number(errorIndex) - 1 : Number(errorIndex), message])));
    setEventErrors((current) => Object.fromEntries(Object.entries(current)
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
    const payloadErrors = Object.fromEntries(events.flatMap((timelineEvent, index) => {
      const validation = normalizeInteractionEventDraft(timelineEvent, index);
      return validation.success ? [] : [[index, validation.error]];
    }));
    setEventErrors(payloadErrors);
    if (Object.keys(errors).length > 0 || Object.keys(payloadErrors).length > 0) event.preventDefault();
  }

  function confirmUnbind(event: MouseEvent<HTMLButtonElement>, live: BoundLive) {
    if (!window.confirm(`確定要解除「${live.title}」與此留言組的綁定嗎？`)) event.preventDefault();
  }

  function handleDragStart(event: DragEvent<HTMLElement>, index: number) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggedEventIndex(index);
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetIndex: number) {
    event.preventDefault();
    const sourceIndex = draggedEventIndex ?? Number.parseInt(event.dataTransfer.getData("text/plain"), 10);
    if (Number.isInteger(sourceIndex)) moveEvent(sourceIndex, targetIndex);
    setDraggedEventIndex(null);
  }

  return (
    <form action="/api/interaction-scripts/upsert" method="post" onSubmit={validateTimeInputs} className="grid gap-5">
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      {error === "invalid_reference" ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          互動事件引用的角色或商品無效，請重新選擇目前商店的資料。
        </p>
      ) : null}
      {error === "invalid_event" ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          互動事件資料不完整。請檢查事件類型、訊息、商品與 CTA 網址後再儲存。
        </p>
      ) : null}
      {script ? <input type="hidden" name="id" value={script.id} /> : null}

      <section className="sticky top-0 z-20 rounded-xl border border-border bg-white/95 p-4 backdrop-blur">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              互動腳本名稱
              <input name="name" required maxLength={160} defaultValue={script?.name ?? "保養導購互動腳本"} className="h-11 rounded-md border border-border px-3 text-base font-semibold text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
              用途說明
              <input name="description" maxLength={1000} defaultValue={script?.description ?? "依影片進度顯示官方訊息、商品與 CTA"} className="h-11 rounded-md border border-border px-3 text-sm text-slate-950 outline-none focus:border-primary focus:ring-2 focus:ring-blue-100" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${script?.status === "published" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
              {script?.status === "published" ? "已發布" : "草稿"}
            </span>
            <FormSubmitButton
              name="status"
              value={script?.status === "published" ? "published" : "draft"}
              pendingChildren="儲存中…"
              pendingMessage="正在儲存互動腳本，請勿重複送出。"
              className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {script ? "儲存變更" : "儲存草稿"}
            </FormSubmitButton>
            <FormSubmitButton
              name="status"
              value={script?.status === "published" ? "draft" : "published"}
              pendingChildren={script?.status === "published" ? "更新中…" : "發布中…"}
              pendingMessage={script?.status === "published" ? "正在將互動腳本轉為草稿。" : "正在發布互動腳本。"}
              className={`inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold ${script?.status === "published" ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-primary text-white hover:bg-primary-dark"}`}
            >
              {script?.status === "published" ? "轉為草稿" : "發布並可選用"}
            </FormSubmitButton>
          </div>
        </div>
      </section>

      {!script ? (
        <section className="grid gap-3 rounded-xl border border-border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">常見互動腳本範本</h2>
              <p className="mt-1 text-sm text-slate-500">先套用官方訊息與商品節奏，再依直播內容微調。</p>
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
        {renderTimelineSidebar({ boundLives, primaryLive, events, products, confirmUnbind })}

        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">事件清單</h2>
              <p className="text-sm text-slate-600">依時間觸發官方訊息、商品聚焦或 CTA；不建立假觀看、假訂單或假成效。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => addEvent("chat_message")} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                <MessageCircle size={16} aria-hidden="true" />
                新增留言
              </button>
              <button
                type="button"
                onClick={() => addEvent("product_spotlight")}
                disabled={products.length === 0}
                title={products.length === 0 ? "請先建立啟用中的商品" : undefined}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShoppingBag size={16} aria-hidden="true" />
                新增商品聚焦
              </button>
              <button type="button" onClick={() => addEvent("cta_switch")} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white hover:bg-primary-dark">
                <Megaphone size={16} aria-hidden="true" />
                新增 CTA
              </button>
            </div>
          </div>

          <div className="max-h-[calc(100vh-200px)] overflow-y-auto">
            <div data-testid="interaction-message-list" className="divide-y divide-slate-200">
              {events.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="font-semibold text-slate-900">尚未建立事件</p>
                  <p className="mt-1 text-sm text-slate-600">先新增一則官方留言，之後再安排商品與 CTA。</p>
                </div>
              ) : null}
              {events.map((event, index) => renderInteractionEventRow({
                event,
                index,
                eventCount: events.length,
                roles: availableRoles,
                products,
                timeInput: timeInputs[index],
                timeError: timeErrors[index],
                eventError: eventErrors[index],
                isDragged: draggedEventIndex === index,
                updateEvent,
                updateTimeInput,
                changeEventType,
                moveEvent,
                removeEvent,
                handleDragStart,
                handleDrop,
                finishDrag: () => setDraggedEventIndex(null),
              }))}
            </div>
          </div>
        </div>
      </section>
    </form>
  );
}
