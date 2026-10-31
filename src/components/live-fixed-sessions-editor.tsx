"use client";

import { useMemo, useRef, useState } from "react";
import { MAX_FIXED_SESSIONS, type FixedSessionDraftRow } from "@/lib/live-fixed-sessions";

/**
 * 指定場次 editor for the Live Studio schedule step. The rows are kept in
 * React state and serialized, sorted, into the hidden `fixedSessions` JSON
 * input so draft autosave/resume and the publish action read one value.
 * The visible inputs have no name; their change events still bubble to the
 * studio form, which schedules the autosave. The server re-validates
 * everything (live-fixed-sessions.ts); these checks only guide the merchant.
 */

export type StoredFixedSessionSummary = {
  /** Wall-clock `YYYY-MM-DDTHH:mm` in the studio timezone. */
  startAt: string;
  registeredCount: number;
  status: string;
};

type EditorRow = FixedSessionDraftRow & { key: string };

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

let rowSequence = 0;
function withKey(row: FixedSessionDraftRow): EditorRow {
  rowSequence += 1;
  return { ...row, key: `fixed-session-row-${rowSequence}` };
}

export function sortedFixedSessionRows(rows: readonly FixedSessionDraftRow[]): FixedSessionDraftRow[] {
  return [...rows]
    .map((row) => ({ startAt: row.startAt.trim(), capacity: row.capacity.trim(), status: row.status }))
    .sort((left, right) => {
      if (!left.startAt) return 1;
      if (!right.startAt) return -1;
      return left.startAt.localeCompare(right.startAt);
    });
}

/** Client-side hints keyed by row; the server remains authoritative. */
export function fixedSessionRowProblems(
  rows: readonly FixedSessionDraftRow[],
  input: { nowLocal: string; storedStartTimes: ReadonlySet<string> },
) {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.startAt) counts.set(row.startAt, (counts.get(row.startAt) ?? 0) + 1);
  return rows.map((row) => {
    if (!LOCAL_DATE_TIME.test(row.startAt)) return "請選擇日期與時間。";
    if ((counts.get(row.startAt) ?? 0) > 1) return "這個時間重複了，同一場直播的場次時間不能相同。";
    if (row.startAt <= input.nowLocal && !input.storedStartTimes.has(row.startAt)) return "新增的場次必須晚於現在，才能排程發布。";
    if (row.capacity && (!/^\d{1,6}$/u.test(row.capacity) || Number(row.capacity) < 1 || Number(row.capacity) > 100_000)) {
      return "名額請輸入 1 到 100000 的整數，留空代表不限。";
    }
    return null;
  });
}

function dayHeading(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return `${year}/${month}/${day}（週${WEEKDAYS[weekday]}）`;
}

export function LiveFixedSessionsEditor({
  timeZoneLabel,
  nowLocal,
  initialMode,
  initialRows,
  initialCutoffMinutes,
  initialReplayWindowHours,
  storedSessions,
  streamMode,
  onModeChange,
  onRowsChange,
}: {
  timeZoneLabel: string;
  /** Current wall-clock `YYYY-MM-DDTHH:mm` in the studio timezone. */
  nowLocal: string;
  initialMode: "single" | "fixed_sessions";
  initialRows: FixedSessionDraftRow[];
  initialCutoffMinutes: string;
  initialReplayWindowHours: string;
  storedSessions: StoredFixedSessionSummary[];
  streamMode: string;
  onModeChange: (mode: "single" | "fixed_sessions") => void;
  onRowsChange: (rows: FixedSessionDraftRow[]) => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [rows, setRows] = useState<EditorRow[]>(initialRows.map(withKey));
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const stored = useMemo(() => new Map(storedSessions.map((session) => [session.startAt, session])), [storedSessions]);
  const storedStartTimes = useMemo(() => new Set(storedSessions.map((session) => session.startAt)), [storedSessions]);
  const problems = fixedSessionRowProblems(rows, { nowLocal, storedStartTimes });
  const sorted = sortedFixedSessionRows(rows);
  const removedWithRegistrations = storedSessions.filter((session) => (
    session.status !== "cancelled"
    && session.registeredCount > 0
    && !rows.some((row) => row.startAt === session.startAt)
  ));
  const cancelledWithRegistrations = storedSessions.filter((session) => session.status === "cancelled" && session.registeredCount > 0);

  function updateRows(next: EditorRow[]) {
    setRows(next);
    onRowsChange(sortedFixedSessionRows(next));
  }

  function changeMode(next: "single" | "fixed_sessions") {
    setMode(next);
    onModeChange(next);
    if (next === "fixed_sessions" && rows.length === 0) updateRows([withKey({ startAt: "", capacity: "", status: "open" })]);
  }

  function addRow() {
    const last = sorted.filter((row) => row.startAt).at(-1);
    updateRows([...rows, withKey({ startAt: "", capacity: last?.capacity ?? "", status: "open" })]);
  }

  const grouped = new Map<string, FixedSessionDraftRow[]>();
  for (const row of sorted) {
    if (!LOCAL_DATE_TIME.test(row.startAt)) continue;
    const date = row.startAt.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), row]);
  }

  return (
    <fieldset className="grid gap-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-semibold text-slate-900">場次安排</legend>
      <div role="radiogroup" aria-label="場次安排" className="flex flex-wrap gap-2">
        <label className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700">
          <input type="radio" name="sessionMode" value="single" checked={mode === "single"} onChange={() => changeMode("single")} className="h-4 w-4 accent-blue-600" />
          單一場次
        </label>
        <label className="flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-slate-700">
          <input type="radio" name="sessionMode" value="fixed_sessions" checked={mode === "fixed_sessions"} onChange={() => changeMode("fixed_sessions")} className="h-4 w-4 accent-blue-600" />
          指定場次（報名者自選一場）
        </label>
      </div>
      {mode === "fixed_sessions" ? (
        <div className="grid gap-3">
          <p className="text-xs text-slate-500">
            每個場次都會在開播時間播放同一支預錄影片；報名者在報名頁選一場，確認信、提醒、觀看頁與回放都依該場次時間計算。時間依{timeZoneLabel}輸入，最多 {MAX_FIXED_SESSIONS} 場。
          </p>
          {streamMode !== "vod" ? (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">指定場次只適用預錄影片播放；請在「媒體」步驟改用影片播放。</p>
          ) : null}
          <input type="hidden" name="fixedSessions" value={JSON.stringify(sorted)} readOnly />
          <ol className="grid gap-3" aria-label="場次列表">
            {rows.map((row, index) => {
              const storedSession = stored.get(row.startAt);
              const problem = problems[index];
              const problemId = `${row.key}-problem`;
              return (
                <li key={row.key} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto] sm:items-end">
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    場次 {index + 1} 的日期與時間
                    <input
                      type="datetime-local"
                      autoComplete="off"
                      value={row.startAt}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? problemId : undefined}
                      onChange={(event) => updateRows(rows.map((candidate) => candidate.key === row.key ? { ...candidate, startAt: event.target.value } : candidate))}
                      className="h-11 rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    名額（選填）
                    <input
                      type="number"
                      inputMode="numeric"
                      min={Math.max(1, storedSession?.registeredCount ?? 1)}
                      max={100000}
                      placeholder="不限"
                      value={row.capacity}
                      onChange={(event) => updateRows(rows.map((candidate) => candidate.key === row.key ? { ...candidate, capacity: event.target.value } : candidate))}
                      className="h-11 rounded-md border border-border px-3"
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.status === "closed"}
                      onChange={(event) => updateRows(rows.map((candidate) => candidate.key === row.key ? { ...candidate, status: event.target.checked ? "closed" : "open" } : candidate))}
                      className="h-4 w-4 accent-blue-600"
                    />
                    暫停報名
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      updateRows(rows.filter((candidate) => candidate.key !== row.key));
                      requestAnimationFrame(() => addButtonRef.current?.focus());
                    }}
                    className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    aria-label={`移除場次 ${index + 1}`}
                  >
                    移除
                  </button>
                  {storedSession && storedSession.registeredCount > 0 ? (
                    <p className="text-xs text-slate-500 sm:col-span-4">已有 {storedSession.registeredCount} 人報名；名額不能低於已報名人數。</p>
                  ) : null}
                  {problem ? <p id={problemId} className="text-xs font-medium text-red-700 sm:col-span-4">{problem}</p> : null}
                </li>
              );
            })}
          </ol>
          <div>
            <button
              ref={addButtonRef}
              type="button"
              onClick={addRow}
              disabled={rows.length >= MAX_FIXED_SESSIONS}
              className="min-h-11 rounded-md border border-blue-200 bg-white px-4 text-sm font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              新增場次
            </button>
          </div>
          {removedWithRegistrations.length > 0 ? (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              儲存後會取消 {removedWithRegistrations.length} 個已有報名的場次：報名紀錄會保留，但該場次不再播放、也不再寄送提醒。
            </p>
          ) : null}
          {cancelledWithRegistrations.length > 0 ? (
            <p className="text-xs text-slate-500">另有 {cancelledWithRegistrations.length} 個已取消的場次保留報名紀錄；重新加入相同時間即可恢復。</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              開播後仍可報名（分鐘）
              <input name="sessionRegistrationCutoffMinutes" type="number" inputMode="numeric" min={0} max={1440} defaultValue={initialCutoffMinutes || "0"} className="h-11 rounded-md border border-border px-3" />
              <span className="text-xs font-normal text-slate-500">0 代表場次開始後就不再接受報名。</span>
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              每場回放保留（小時，選填）
              <input name="sessionReplayWindowHours" type="number" inputMode="numeric" min={1} max={8760} defaultValue={initialReplayWindowHours} placeholder="依回放期限" className="h-11 rounded-md border border-border px-3" />
              <span className="text-xs font-normal text-slate-500">從各場次結束起算；仍受上方回放開關與回放期限限制。</span>
            </label>
          </div>
          <section aria-label="場次一覽" className="grid gap-2 rounded-md bg-slate-50 px-3 py-2">
            <h3 className="text-sm font-semibold text-slate-900">場次一覽（共 {sorted.filter((row) => LOCAL_DATE_TIME.test(row.startAt)).length} 場）</h3>
            {grouped.size === 0 ? <p className="text-sm text-slate-500">尚未設定場次。</p> : (
              <ul className="grid gap-1 text-sm text-slate-700">
                {[...grouped.entries()].map(([date, dayRows]) => (
                  <li key={date}>
                    <span className="font-medium">{dayHeading(date)}</span>
                    {" "}
                    {dayRows.map((row) => `${row.startAt.slice(11)}${row.capacity ? `（${row.capacity} 名）` : ""}${row.status === "closed" ? "（暫停報名）" : ""}`).join("、")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </fieldset>
  );
}
