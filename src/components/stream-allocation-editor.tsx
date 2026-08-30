"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveStudioDraftPayload } from "@/lib/live-studio-draft";

export type StreamAllocationMemberOption = {
  id: string;
  teamId: string;
  label: string;
};

export type StreamAllocationPageOption = {
  id: string;
  label: string;
};

type AllocationRow = { rowId: string; memberKey: string; percent: string };
type MemberQuotaRow = { rowId: string; memberKey: string; minutes: string };
type PageQuotaRow = { rowId: string; pageId: string; minutes: string };

function parseArray(value: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
}

function percentageFromBps(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? String(value / 100) : "";
}

function initialAllocationRows(value: string): AllocationRow[] {
  return parseArray(value).map((item, index) => ({
    rowId: `allocation-${index}`,
    memberKey: `${String(item.teamId ?? "")}:${String(item.membershipId ?? "")}`,
    percent: percentageFromBps(item.bps),
  }));
}

function initialMemberQuotaRows(value: string): MemberQuotaRow[] {
  return parseArray(value).map((item, index) => ({
    rowId: `member-quota-${index}`,
    memberKey: `${String(item.teamId ?? "")}:${String(item.membershipId ?? "")}`,
    minutes: typeof item.includedMinutes === "number" ? String(item.includedMinutes) : "",
  }));
}

function initialPageQuotaRows(value: string): PageQuotaRow[] {
  return parseArray(value).map((item, index) => ({
    rowId: `page-quota-${index}`,
    pageId: String(item.pageId ?? ""),
    minutes: typeof item.includedMinutes === "number" ? String(item.includedMinutes) : "",
  }));
}

function memberKey(option: StreamAllocationMemberOption) {
  return `${option.teamId}:${option.id}`;
}

function bpsFromPercent(value: string) {
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.round(percent * 100) : 0;
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1_000_000 ? parsed : 0;
}

function hasDuplicates(values: string[]) {
  return new Set(values).size !== values.length;
}

export function StreamAllocationEditor({
  initialValues,
  members,
  pages,
}: {
  initialValues: Pick<LiveStudioDraftPayload,
    "usageAttributionMode" | "quotaPayerScope" | "splitOwnerBps" | "splitPromoterBps" |
    "customAllocations" | "memberQuotas" | "pageQuotas">;
  members: StreamAllocationMemberOption[];
  pages: StreamAllocationPageOption[];
}) {
  const [usageMode, setUsageMode] = useState(initialValues.usageAttributionMode);
  const [payerScope, setPayerScope] = useState(initialValues.quotaPayerScope);
  const [ownerPercent, setOwnerPercent] = useState(String(Number(initialValues.splitOwnerBps || "3000") / 100));
  const [allocations, setAllocations] = useState(() => initialAllocationRows(initialValues.customAllocations));
  const [memberQuotas, setMemberQuotas] = useState(() => initialMemberQuotaRows(initialValues.memberQuotas));
  const [pageQuotas, setPageQuotas] = useState(() => initialPageQuotaRows(initialValues.pageQuotas));
  const nextRowId = useRef(1000);
  const modeControl = useRef<HTMLSelectElement>(null);
  const membersByKey = useMemo(() => new Map(members.map((member) => [memberKey(member), member])), [members]);
  const pagesById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);

  const ownerBps = bpsFromPercent(ownerPercent);
  const promoterBps = 10_000 - ownerBps;
  const allocationBpsTotal = allocations.reduce((sum, row) => sum + bpsFromPercent(row.percent), 0);
  const allocationKeys = allocations.map((row) => row.memberKey).filter(Boolean);
  const memberQuotaKeys = memberQuotas.map((row) => row.memberKey).filter(Boolean);
  const pageQuotaKeys = pageQuotas.map((row) => row.pageId).filter(Boolean);

  const policyIssue = useMemo(() => {
    if (usageMode === "SPLIT" && (ownerBps < 0 || ownerBps > 10_000)) {
      return "內容負責人的分攤比例必須介於 0% 到 100%。";
    }
    if (usageMode === "CUSTOM") {
      if (allocations.length === 0) return "自訂分攤至少要加入一位成員。";
      if (allocationKeys.length !== allocations.length || allocationKeys.some((key) => !membersByKey.has(key))) {
        return "請為每一筆自訂分攤選擇目前有效的團隊成員。";
      }
      if (hasDuplicates(allocationKeys)) return "同一位成員不能重複分攤。";
      if (allocationBpsTotal !== 10_000) return "自訂分攤比例合計必須剛好為 100%。";
    }
    if (memberQuotaKeys.length !== memberQuotas.length || memberQuotaKeys.some((key) => !membersByKey.has(key))) {
      return "請為每一筆成員額度選擇目前有效的團隊成員。";
    }
    if (hasDuplicates(memberQuotaKeys)) return "同一位成員不能設定兩次額度。";
    if (memberQuotas.some((row) => positiveInteger(row.minutes) === 0)) return "成員額度必須是大於 0 的整數分鐘。";
    if (pageQuotaKeys.length !== pageQuotas.length || pageQuotaKeys.some((id) => !pagesById.has(id))) {
      return "請為每一筆推廣頁額度選擇目前有效的推廣頁。";
    }
    if (hasDuplicates(pageQuotaKeys)) return "同一個推廣頁不能設定兩次額度。";
    if (pageQuotas.some((row) => positiveInteger(row.minutes) === 0)) return "推廣頁額度必須是大於 0 的整數分鐘。";
    if (payerScope === "MEMBER" && memberQuotas.length === 0 && usageMode !== "CUSTOM") {
      return "選擇由成員負責額度時，至少要加入一筆成員額度。";
    }
    return "";
  }, [
    allocationBpsTotal,
    allocationKeys,
    allocations.length,
    memberQuotaKeys,
    memberQuotas,
    membersByKey,
    ownerBps,
    pageQuotaKeys,
    pageQuotas,
    pagesById,
    payerScope,
    usageMode,
  ]);

  useEffect(() => {
    modeControl.current?.setCustomValidity(policyIssue);
  }, [policyIssue]);

  const customAllocationValue = JSON.stringify(
    usageMode === "CUSTOM"
      ? allocations.map((row) => {
          const member = membersByKey.get(row.memberKey);
          return { teamId: member?.teamId ?? "", membershipId: member?.id ?? "", bps: bpsFromPercent(row.percent) };
        })
      : [],
  );
  const memberQuotaValue = JSON.stringify(memberQuotas.map((row) => {
    const member = membersByKey.get(row.memberKey);
    return {
      teamId: member?.teamId ?? "",
      membershipId: member?.id ?? "",
      includedMinutes: positiveInteger(row.minutes),
    };
  }));
  const pageQuotaValue = JSON.stringify(pageQuotas.map((row) => ({
    pageId: pagesById.get(row.pageId)?.id ?? "",
    includedMinutes: positiveInteger(row.minutes),
  })));

  function addAllocation() {
    const selected = new Set(allocations.map((row) => row.memberKey));
    const available = members.find((member) => !selected.has(memberKey(member)));
    setAllocations((rows) => [...rows, {
      rowId: `allocation-${nextRowId.current++}`,
      memberKey: available ? memberKey(available) : "",
      percent: "",
    }]);
  }

  function addMemberQuota() {
    const selected = new Set(memberQuotas.map((row) => row.memberKey));
    const available = members.find((member) => !selected.has(memberKey(member)));
    setMemberQuotas((rows) => [...rows, {
      rowId: `member-quota-${nextRowId.current++}`,
      memberKey: available ? memberKey(available) : "",
      minutes: "60",
    }]);
  }

  function addPageQuota() {
    const selected = new Set(pageQuotas.map((row) => row.pageId));
    const available = pages.find((page) => !selected.has(page.id));
    setPageQuotas((rows) => [...rows, {
      rowId: `page-quota-${nextRowId.current++}`,
      pageId: available?.id ?? "",
      minutes: "120",
    }]);
  }

  return (
    <section aria-labelledby="stream-allocation-heading" className="grid gap-4 rounded-lg border border-blue-100 bg-blue-50/40 p-4">
      <div>
        <h3 id="stream-allocation-heading" className="font-semibold text-slate-950">Stream 用量與額度分配</h3>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          選擇誰負責這場直播的觀看用量。系統會把設定存成不可變更的用量快照，不需要手寫 ID 或 JSON。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          用量歸屬方式
          <select
            ref={modeControl}
            name="usageAttributionMode"
            value={usageMode}
            onChange={(event) => setUsageMode(event.target.value as LiveStudioDraftPayload["usageAttributionMode"])}
            aria-describedby="stream-policy-status"
            className="h-11 rounded-md border border-border bg-white px-3"
          >
            <option value="PROMOTER">推廣頁流量歸推廣者；直接流量歸內容負責人</option>
            <option value="OWNER">全部歸內容負責人</option>
            <option value="SPLIT">內容負責人與推廣者按比例分攤</option>
            <option value="CUSTOM">指定團隊成員與比例</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          額度責任
          <select
            name="quotaPayerScope"
            value={payerScope}
            onChange={(event) => setPayerScope(event.target.value as LiveStudioDraftPayload["quotaPayerScope"])}
            className="h-11 rounded-md border border-border bg-white px-3"
          >
            <option value="VENDOR">商家統一負責</option>
            <option value="MEMBER">依下方成員額度負責</option>
          </select>
        </label>
      </div>

      {usageMode === "SPLIT" ? (
        <div className="grid gap-3 rounded-md border border-border bg-white p-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            內容負責人比例（%）
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              required
              value={ownerPercent}
              onChange={(event) => setOwnerPercent(event.target.value)}
              className="h-11 rounded-md border border-border px-3"
            />
          </label>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p className="font-medium">推廣者比例</p>
            <p className="mt-1 text-lg font-bold text-slate-950">{promoterBps / 100}%</p>
            <p className="mt-1 text-xs text-slate-500">系統自動補足到 100%，避免比例相加錯誤。</p>
          </div>
        </div>
      ) : null}

      {usageMode === "CUSTOM" ? (
        <div className="grid gap-3 rounded-md border border-border bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">指定成員分攤</p>
              <p className="text-xs text-slate-500">目前合計 {allocationBpsTotal / 100}%／100%</p>
            </div>
            <button type="button" onClick={addAllocation} disabled={members.length === 0 || allocations.length >= members.length} className="min-h-10 rounded-md border border-blue-200 px-3 text-sm font-semibold text-primary disabled:opacity-50">
              加入成員
            </button>
          </div>
          {allocations.length === 0 ? <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">尚未加入成員。請至少加入一位，合計設定為 100%。</p> : null}
          {allocations.map((row) => (
            <div key={row.rowId} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                團隊成員
                <select required value={row.memberKey} onChange={(event) => setAllocations((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, memberKey: event.target.value } : item))} className="h-11 rounded-md border border-border px-3">
                  <option value="">請選擇</option>
                  {!membersByKey.has(row.memberKey) && row.memberKey ? <option value={row.memberKey}>原設定已無法使用</option> : null}
                  {members.map((member) => <option key={memberKey(member)} value={memberKey(member)}>{member.label}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                分攤比例（%）
                <input type="number" inputMode="decimal" min="0.01" max="100" step="0.01" required value={row.percent} onChange={(event) => setAllocations((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, percent: event.target.value } : item))} className="h-11 rounded-md border border-border px-3" />
              </label>
              <button type="button" onClick={() => setAllocations((rows) => rows.filter((item) => item.rowId !== row.rowId))} className="min-h-11 rounded-md border border-red-200 px-3 text-sm font-semibold text-red-700">移除</button>
            </div>
          ))}
        </div>
      ) : null}

      <details className="rounded-md border border-border bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">進階：個別成員與推廣頁額度</summary>
        <p className="mt-2 text-xs leading-5 text-slate-500">只有真的需要限制特定成員或推廣頁時才設定；留空會使用商家整體 Stream 額度。</p>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="grid content-start gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">成員額度</p>
              <button type="button" onClick={addMemberQuota} disabled={members.length === 0 || memberQuotas.length >= members.length} className="min-h-10 rounded-md border border-blue-200 px-3 text-xs font-semibold text-primary disabled:opacity-50">加入成員</button>
            </div>
            {memberQuotas.length === 0 ? <p className="text-sm text-slate-500">未設定個別成員額度。</p> : null}
            {memberQuotas.map((row) => (
              <div key={row.rowId} className="grid gap-2 rounded-md bg-slate-50 p-3">
                <select aria-label="額度成員" required value={row.memberKey} onChange={(event) => setMemberQuotas((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, memberKey: event.target.value } : item))} className="h-11 rounded-md border border-border bg-white px-3 text-sm">
                  <option value="">請選擇成員</option>
                  {!membersByKey.has(row.memberKey) && row.memberKey ? <option value={row.memberKey}>原設定已無法使用</option> : null}
                  {members.map((member) => <option key={memberKey(member)} value={memberKey(member)}>{member.label}</option>)}
                </select>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input aria-label="成員額度分鐘" type="number" inputMode="numeric" min={1} max={1_000_000} required value={row.minutes} onChange={(event) => setMemberQuotas((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, minutes: event.target.value } : item))} className="h-11 rounded-md border border-border bg-white px-3 text-sm" />
                  <button type="button" onClick={() => setMemberQuotas((rows) => rows.filter((item) => item.rowId !== row.rowId))} className="min-h-11 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700">移除</button>
                </div>
              </div>
            ))}
          </div>
          <div className="grid content-start gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900">推廣頁額度</p>
              <button type="button" onClick={addPageQuota} disabled={pages.length === 0 || pageQuotas.length >= pages.length} className="min-h-10 rounded-md border border-blue-200 px-3 text-xs font-semibold text-primary disabled:opacity-50">加入推廣頁</button>
            </div>
            {pageQuotas.length === 0 ? <p className="text-sm text-slate-500">未設定個別推廣頁額度。</p> : null}
            {pageQuotas.map((row) => (
              <div key={row.rowId} className="grid gap-2 rounded-md bg-slate-50 p-3">
                <select aria-label="額度推廣頁" required value={row.pageId} onChange={(event) => setPageQuotas((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, pageId: event.target.value } : item))} className="h-11 rounded-md border border-border bg-white px-3 text-sm">
                  <option value="">請選擇推廣頁</option>
                  {!pagesById.has(row.pageId) && row.pageId ? <option value={row.pageId}>原設定已無法使用</option> : null}
                  {pages.map((page) => <option key={page.id} value={page.id}>{page.label}</option>)}
                </select>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input aria-label="推廣頁額度分鐘" type="number" inputMode="numeric" min={1} max={1_000_000} required value={row.minutes} onChange={(event) => setPageQuotas((rows) => rows.map((item) => item.rowId === row.rowId ? { ...item, minutes: event.target.value } : item))} className="h-11 rounded-md border border-border bg-white px-3 text-sm" />
                  <button type="button" onClick={() => setPageQuotas((rows) => rows.filter((item) => item.rowId !== row.rowId))} className="min-h-11 rounded-md border border-red-200 px-3 text-xs font-semibold text-red-700">移除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>

      <input type="hidden" name="splitOwnerBps" value={String(ownerBps)} />
      <input type="hidden" name="splitPromoterBps" value={String(promoterBps)} />
      <input type="hidden" name="customAllocations" value={customAllocationValue} />
      <input type="hidden" name="memberQuotas" value={memberQuotaValue} />
      <input type="hidden" name="pageQuotas" value={pageQuotaValue} />
      <p id="stream-policy-status" role={policyIssue ? "alert" : "status"} aria-live="polite" className={`text-sm font-medium ${policyIssue ? "text-red-700" : "text-emerald-700"}`}>
        {policyIssue || "Stream 用量設定完整，會隨直播草稿一起安全儲存。"}
      </p>
    </section>
  );
}
