"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LIVE_SESSION_RESULT_COOKIE, type PublicFixedSession, type PublicFixedSessionDay } from "@/lib/live-fixed-sessions";

/**
 * Session picker (指定場次) for a registration form bound to a fixed-session
 * Live: a swipeable row of date chips, then that day's time slots. Both rows
 * are radio groups (roving tabindex, arrow keys), every target is at least
 * 44px, and colours come from the surrounding theme (currentColor plus the
 * `--live-session-accent` variables a designed form derives from its submit
 * button), so every funnel template renders it in its own look.
 */

export type LiveSessionsData = {
  liveId: string;
  timeZone: string;
  registrationClosesAfterStartMinutes?: number;
  days: PublicFixedSessionDay[];
};

export const LIVE_SESSION_REQUIRED_MESSAGE = "請選擇要參加的場次。";
export const LIVE_SESSION_NONE_OPEN_MESSAGE = "目前沒有可報名的場次，請稍後再來。";


/** First date that still has a seat; falls back to the first date so full days stay visible. */
export function firstAvailableDate(days: readonly PublicFixedSessionDay[]): string | null {
  const open = days.find((day) => day.sessions.some((session) => !session.full));
  return (open ?? days[0])?.date ?? null;
}

export function findLiveSession(days: readonly PublicFixedSessionDay[], sessionId: string | null) {
  if (!sessionId) return null;
  for (const day of days) {
    const session = day.sessions.find((item) => item.id === sessionId);
    if (session) return { day, session };
  }
  return null;
}

export function liveSessionChoiceLabel(choice: { day: PublicFixedSessionDay; session: PublicFixedSession }) {
  return `${choice.day.label} ${choice.session.timeLabel}`;
}

/**
 * The session the server confirmed for this browser's last registration of
 * `liveId` (cookie written by POST /api/form-submissions from the database,
 * 30 minutes). The thank-you step shows only this, never the visitor's own
 * pick, so a registration that did not move never shows the wrong session.
 */
function readConfirmedCookie(): Record<string, unknown> | null {
  try {
    const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${LIVE_SESSION_RESULT_COOKIE}=`));
    if (!entry) return null;
    const value: unknown = JSON.parse(decodeURIComponent(entry.slice(LIVE_SESSION_RESULT_COOKIE.length + 1)));
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch { return null; }
}
/** Drops a previous registration's confirmed session when a fresh registration page opens. */
export function forgetChosenLiveSession(liveId: string) {
  try {
    if (readConfirmedCookie()?.liveId === liveId) document.cookie = `${LIVE_SESSION_RESULT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  } catch { /* cookies may be blocked */ }
}
/** The confirmed record as a stable string (for useSyncExternalStore); null when absent, for another Live or malformed. */
export function readChosenLiveSessionRaw(liveId: string): string | null {
  const value = readConfirmedCookie();
  if (!value || value.liveId !== liveId || typeof value.label !== "string" || typeof value.startAt !== "string") return null;
  return JSON.stringify({ label: value.label, startAt: value.startAt });
}
export function readChosenLiveSession(liveId: string): { label: string; startAt: string } | null {
  const raw = readChosenLiveSessionRaw(liveId);
  return raw ? JSON.parse(raw) as { label: string; startAt: string } : null;
}

/** Selection state shared by the JSON form and the native-POST forms. */
export function useLiveSessionSelection(initial: LiveSessionsData | undefined) {
  const [data, setData] = useState<LiveSessionsData | undefined>(initial);
  const [dateKey, setDateKey] = useState<string | null>(() => (initial ? firstAvailableDate(initial.days) : null));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // A new server payload (navigation) replaces ours.
  const lastInitial = useRef(initial);
  useEffect(() => {
    if (lastInitial.current === initial) return;
    lastInitial.current = initial;
    setData(initial);
    setDateKey(initial ? firstAvailableDate(initial.days) : null);
    setSessionId(null);
  }, [initial]);

  const selectDate = useCallback((date: string) => {
    setDateKey(date);
    setSessionId((current) => (data && findLiveSession(data.days, current)?.day.date === date ? current : null));
  }, [data]);
  const selectSession = useCallback((id: string) => { setSessionId(id); setError(""); }, []);

  const active = Boolean(data);
  const choice = data ? findLiveSession(data.days, sessionId) : null;
  /** null = fine to submit; otherwise the inline message to show. */
  const validate = useCallback((): string | null => {
    if (!data) return null;
    if (data.days.length === 0) return LIVE_SESSION_NONE_OPEN_MESSAGE;
    const picked = findLiveSession(data.days, sessionId);
    if (!picked || picked.session.full) return LIVE_SESSION_REQUIRED_MESSAGE;
    return null;
  }, [data, sessionId]);

  /** Re-reads the open sessions (after a 409) and keeps the date when it still exists. */
  const refresh = useCallback(async () => {
    if (!data) return;
    setRefreshing(true);
    try {
      const response = await fetch(`/api/live-sessions?${new URLSearchParams({ liveId: data.liveId }).toString()}`, { headers: { "X-CelebrateDeal-Client": "web" }, cache: "no-store" });
      // 404: the live is no longer publish-ready, so nothing can be picked; the form stays unsubmittable.
      if (response.status === 404) { setData({ ...data, days: [] }); setDateKey(null); setSessionId(null); return; }
      if (!response.ok) return;
      const next = parseLiveSessionsData(await response.json());
      if (!next) return;
      setData(next);
      setDateKey((current) => (current && next.days.some((day) => day.date === current) ? current : firstAvailableDate(next.days)));
      setSessionId((current) => (findLiveSession(next.days, current)?.session.full === false ? current : null));
    } catch { /* keep the list we have; the error message already tells the visitor what to do */ } finally { setRefreshing(false); }
  }, [data]);

  return { active, data, dateKey, sessionId, choice, error, setError, refreshing, selectDate, selectSession, validate, refresh };
}

export type LiveSessionSelection = ReturnType<typeof useLiveSessionSelection>;

/**
 * Everything a registration form needs around the picker: selection state,
 * the submit gate (inline error plus focus), the payload field and the
 * remembered choice for the thank-you step.
 */
export function useLiveSessionForm(initial: LiveSessionsData | undefined) {
  const sessions = useLiveSessionSelection(initial);
  const formRef = useRef<HTMLFormElement>(null);
  const liveId = initial?.liveId;
  // A fresh registration page never carries a previous attempt's choice to the thank-you step.
  useEffect(() => { if (liveId) forgetChosenLiveSession(liveId); }, [liveId]);
  const { validate, setError, sessionId } = sessions;
  /** True (and the problem shown inline) while a session is still required. */
  const missing = useCallback(() => {
    const problem = validate();
    if (!problem) return false;
    setError(problem);
    focusLiveSessionPicker(formRef.current);
    return true;
  }, [validate, setError]);
  return { sessions, formRef, fixed: Boolean(liveId), payload: liveId ? { liveSessionId: sessionId } : {}, missing };
}

function parseLiveSessionsData(value: unknown): LiveSessionsData | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.liveId !== "string" || !Array.isArray(body.days)) return null;
  const days: PublicFixedSessionDay[] = [];
  for (const rawDay of body.days) {
    if (!rawDay || typeof rawDay !== "object") return null;
    const day = rawDay as Record<string, unknown>;
    if (typeof day.date !== "string" || typeof day.label !== "string" || !Array.isArray(day.sessions)) return null;
    const sessions: PublicFixedSession[] = [];
    for (const rawSession of day.sessions) {
      if (!rawSession || typeof rawSession !== "object") return null;
      const session = rawSession as Record<string, unknown>;
      if (typeof session.id !== "string" || typeof session.startAt !== "string" || typeof session.timeLabel !== "string" || typeof session.full !== "boolean") return null;
      sessions.push({
        id: session.id,
        startAt: session.startAt,
        timeLabel: session.timeLabel,
        capacity: typeof session.capacity === "number" ? session.capacity : null,
        remaining: typeof session.remaining === "number" ? session.remaining : null,
        full: session.full,
      });
    }
    days.push({ date: day.date, label: day.label, sessions });
  }
  return {
    liveId: body.liveId,
    timeZone: typeof body.timeZone === "string" ? body.timeZone : "Asia/Taipei",
    ...(typeof body.registrationClosesAfterStartMinutes === "number" ? { registrationClosesAfterStartMinutes: body.registrationClosesAfterStartMinutes } : {}),
    days,
  };
}

/**
 * Maps a failed registration of a fixed-session form to what the visitor
 * should see: a full/closed seat (409, also for a duplicate email switching
 * seats) reloads the list, 429 is the per-session rate limit, and a 400 for a
 * missing choice asks for one. Anything else is left to the generic message.
 */
export async function describeLiveSessionFailure(response: Response): Promise<{ message: string; refresh: boolean } | null> {
  if (response.status === 409) {
    // The same email already holds another session that cannot be changed from here.
    const registered = await alreadyRegisteredSession(response);
    if (registered) return { message: `你已報名 ${registered} 場次`, refresh: false };
    return { message: "此時段已額滿或已截止，請改選其他時段", refresh: true };
  }
  if (response.status === 429) return { message: "報名次數過多，請稍後再試", refresh: false };
  if (response.status !== 400) return null;
  try {
    const body: unknown = await response.clone().json();
    if (body && typeof body === "object" && (body as { error?: unknown }).error === "Fixed session selection required") return { message: LIVE_SESSION_REQUIRED_MESSAGE, refresh: false };
  } catch { /* not JSON: generic validation message */ }
  return null;
}

async function alreadyRegisteredSession(response: Response) {
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== "object") return null;
    const record = body as { error?: unknown; sessionLabel?: unknown };
    return record.error === "Already registered for another session" && typeof record.sessionLabel === "string" ? record.sessionLabel : null;
  } catch { return null; }
}

/** The session the server confirmed in a successful registration response, if any. */
export async function confirmedSessionFromResponse(response: Response): Promise<{ id: string; startAt: string; label: string } | null> {
  try {
    const body: unknown = await response.clone().json();
    const session = body && typeof body === "object" ? (body as { liveSession?: unknown }).liveSession : null;
    if (!session || typeof session !== "object") return null;
    const value = session as Record<string, unknown>;
    return typeof value.id === "string" && typeof value.startAt === "string" && typeof value.label === "string"
      ? { id: value.id, startAt: value.startAt, label: value.label }
      : null;
  } catch { return null; }
}

/** "10月30日（週五）" -> "10/30 週五". */
export function dateChipLabel(day: PublicFixedSessionDay) {
  const [, month, date] = day.date.split("-");
  const weekday = /（(週.)）/u.exec(day.label)?.[1] ?? "";
  return { numeric: `${Number(month)}/${Number(date)}`, weekday };
}

const TARGET = "min-h-11 min-w-11";
const CHIP_BASE = `${TARGET} shrink-0 snap-start cursor-pointer rounded-lg border px-4 py-2 text-center leading-tight outline-offset-2 focus-visible:outline-2 disabled:cursor-not-allowed`;
const BORDER = "color-mix(in srgb, currentColor 38%, transparent)";
const SURFACE = "color-mix(in srgb, currentColor 7%, transparent)";

/**
 * Selected chip colours when the form supplies no accent: an explicit pair
 * (white on blue-700, 6.7:1) that never depends on `color-scheme`, so a dark
 * template's light text colour cannot turn it into white on white.
 */
export const LIVE_SESSION_FALLBACK_ACCENT = "#1d4ed8";
export const LIVE_SESSION_FALLBACK_ACCENT_TEXT = "#ffffff";

function chipStyle(selected: boolean, disabled: boolean): CSSProperties {
  const base: CSSProperties = { outlineColor: `var(--live-session-accent, ${LIVE_SESSION_FALLBACK_ACCENT})` };
  if (selected) return { ...base, backgroundColor: `var(--live-session-accent, ${LIVE_SESSION_FALLBACK_ACCENT})`, color: `var(--live-session-accent-text, ${LIVE_SESSION_FALLBACK_ACCENT_TEXT})`, borderColor: `var(--live-session-accent, ${LIVE_SESSION_FALLBACK_ACCENT})` };
  return { ...base, backgroundColor: SURFACE, borderColor: BORDER, borderStyle: disabled ? "dashed" : "solid", opacity: disabled ? 0.6 : 1, color: "inherit" };
}

function nextIndex(key: string, index: number, length: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}

export function LiveSessionPicker({ selection, locked = false, accentStyle }: { selection: LiveSessionSelection; locked?: boolean; accentStyle?: CSSProperties }) {
  const { data, dateKey, sessionId, error, refreshing, selectDate, selectSession } = selection;
  const id = useId();
  const dateRefs = useRef(new Map<string, HTMLButtonElement>());
  const timeRefs = useRef(new Map<string, HTMLButtonElement>());
  const rowRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const days = data?.days ?? [];
  const day = days.find((item) => item.date === dateKey) ?? days[0];

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const max = row.scrollWidth - row.clientWidth;
    setOverflow({ left: row.scrollLeft > 1, right: max > 1 && row.scrollLeft < max - 1 });
  }, []);
  useEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure, days.length]);

  if (!data) return null;
  const errorId = `${id}-error`;
  const liveId = `${id}-live`;
  const available = day?.sessions.filter((session) => !session.full).length ?? 0;
  const announcement = day ? `${day.label}共 ${day.sessions.length} 個時段，${available} 個可報名。` : "";

  function scrollBy(direction: 1 | -1) {
    const row = rowRef.current;
    if (row && typeof row.scrollBy === "function") row.scrollBy({ left: direction * Math.max(120, row.clientWidth * 0.7), behavior: "smooth" });
  }
  function onDateKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = nextIndex(event.key, index, days.length);
    if (target === null) return;
    event.preventDefault();
    const next = days[target]!;
    selectDate(next.date);
    const button = dateRefs.current.get(next.date);
    button?.focus();
    if (typeof button?.scrollIntoView === "function") button.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
  function onTimeKey(event: KeyboardEvent<HTMLButtonElement>, sessions: PublicFixedSession[], index: number) {
    const open = sessions.filter((session) => !session.full);
    const current = open.findIndex((session) => session.id === sessions[index]!.id);
    const target = nextIndex(event.key, current < 0 ? 0 : current, open.length);
    if (target === null || open.length === 0) return;
    event.preventDefault();
    const next = open[target]!;
    selectSession(next.id);
    timeRefs.current.get(next.id)?.focus();
  }

  const timeTabStop = day?.sessions.find((session) => session.id === sessionId && !session.full)?.id ?? day?.sessions.find((session) => !session.full)?.id;
  const noneOpen = days.length === 0;

  return <div data-live-session-picker className="grid min-w-0 gap-3" style={accentStyle} role="group" aria-labelledby={`${id}-label`} aria-describedby={error ? errorId : undefined}>
    <input type="hidden" name="liveSessionId" value={sessionId ?? ""} />
    <p id={`${id}-label`} className="m-0 text-[0.9375em] font-semibold">選擇場次 <span aria-hidden="true">*</span></p>
    {noneOpen ? <p className="m-0 text-[0.9375em]">{LIVE_SESSION_NONE_OPEN_MESSAGE}</p> : <>
      <div className="relative min-w-0">
        {overflow.left ? <button type="button" aria-label="顯示較早的日期" onClick={() => scrollBy(-1)} className={`${TARGET} absolute top-0 left-0 z-10 hidden cursor-pointer items-center justify-center rounded-lg border md:flex`} style={{ ...chipStyle(false, false), backgroundColor: "Canvas", color: "CanvasText" }}><span aria-hidden>‹</span></button> : null}
        <div ref={rowRef} onScroll={measure} role="radiogroup" aria-label="選擇日期" data-live-session-dates className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-smooth px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.map((item, index) => {
            const selected = item.date === day?.date;
            const chip = dateChipLabel(item);
            const full = item.sessions.every((session) => session.full);
            return <button key={item.date} ref={(node) => { if (node) dateRefs.current.set(item.date, node); else dateRefs.current.delete(item.date); }}
              type="button" role="radio" aria-checked={selected} aria-label={`${item.label}${full ? "，已額滿" : ""}`} tabIndex={selected ? 0 : -1} disabled={locked}
              onClick={() => selectDate(item.date)} onKeyDown={(event) => onDateKey(event, index)}
              className={`${CHIP_BASE} min-w-[5.5rem]`} style={chipStyle(selected, full)}>
              <span className="block text-[1.0625em] font-semibold">{chip.numeric}</span>
              <span className="block text-[0.8125em]">{full ? "額滿" : chip.weekday}</span>
            </button>;
          })}
        </div>
        {overflow.right ? <button type="button" aria-label="顯示更晚的日期" onClick={() => scrollBy(1)} className={`${TARGET} absolute top-0 right-0 z-10 hidden cursor-pointer items-center justify-center rounded-lg border md:flex`} style={{ ...chipStyle(false, false), backgroundColor: "Canvas", color: "CanvasText" }}><span aria-hidden>›</span></button> : null}
      </div>
      <p id={liveId} role="status" aria-live="polite" className="sr-only">{announcement}</p>
      {day ? <div role="radiogroup" aria-label={`${day.label}的時段`} aria-required="true" aria-invalid={error ? true : undefined} data-live-session-times className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(8.5rem, 1fr))" }}>
        {day.sessions.map((session, index) => {
          const selected = session.id === sessionId;
          const hint = session.full ? "額滿" : session.remaining !== null ? `剩 ${session.remaining} 位` : "";
          return <button key={session.id} ref={(node) => { if (node) timeRefs.current.set(session.id, node); else timeRefs.current.delete(session.id); }}
            type="button" role="radio" aria-checked={selected} aria-label={`${session.timeLabel}${hint ? `，${hint}` : ""}`} tabIndex={session.id === timeTabStop ? 0 : -1} disabled={locked || session.full}
            onClick={() => selectSession(session.id)} onKeyDown={(event) => onTimeKey(event, day.sessions, index)}
            className={`${CHIP_BASE} w-full`} style={chipStyle(selected, session.full)}>
            <span className="block text-[1.0625em] font-semibold">{session.timeLabel}</span>
            {hint ? <span className="block text-[0.8125em]">{hint}</span> : null}
          </button>;
        })}
      </div> : null}
    </>}
    {refreshing ? <p className="m-0 text-[0.875em]" role="status">正在更新場次…</p> : null}
    {error ? <p id={errorId} role="alert" className="m-0 text-[0.9375em] font-semibold">{error}</p> : null}
  </div>;
}

/** Focuses the active slot (after a validation failure) so keyboard and screen reader users land on the problem. */
export function focusLiveSessionPicker(root: ParentNode | null) {
  const target = root?.querySelector<HTMLElement>('[data-live-session-times] [role="radio"][tabindex="0"]') ?? root?.querySelector<HTMLElement>('[data-live-session-dates] [role="radio"][tabindex="0"]');
  target?.focus();
}
