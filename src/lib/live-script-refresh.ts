import { mergeLiveResourceOptions } from "@/lib/live-resource-quick-create";

/**
 * The studio's 互動腳本 select is refreshed when the merchant comes back from
 * the tab where they created a script. Client-safe and pure; the Server Action
 * in `src/app/actions/live-interaction-scripts.ts` supplies the fetched list.
 */
export type LiveScriptRefreshOption = { id: string; name: string };

/** A refresh started less than this long after the previous one is skipped. */
export const LIVE_SCRIPT_REFRESH_MIN_INTERVAL_MS = 5_000;

export type LiveScriptListResult =
  | { status: "success"; scripts: LiveScriptRefreshOption[] }
  | { status: "error" };

/** True when an automatic refresh must wait; `lastStartedAt` is null before the first one. */
export function isLiveScriptRefreshThrottled(lastStartedAt: number | null, now: number) {
  return lastStartedAt !== null && now - lastStartedAt < LIVE_SCRIPT_REFRESH_MIN_INTERVAL_MS && now >= lastStartedAt;
}

export type LiveScriptRefreshPlan = {
  /** Server props merged with everything fetched, without duplicates. */
  options: LiveScriptRefreshOption[];
  /** Set only when exactly one script is new and nothing is selected. */
  autoSelectId: string | null;
  /** Empty when an automatic refresh found nothing to say. */
  announcement: string;
};

/**
 * Merges a fetched list into the known options and decides what the merchant
 * is told. A new script is selected only when it is the only new one and the
 * select is empty; an existing choice is never replaced.
 */
export function planLiveScriptRefresh(input: {
  known: LiveScriptRefreshOption[];
  fetched: LiveScriptRefreshOption[];
  selectedId: string;
  /** The merchant pressed 「重新整理清單」, so a refresh without news is announced too. */
  manual: boolean;
  /** The studio is submitting, so nothing may be selected right now. */
  canAutoSelect: boolean;
}): LiveScriptRefreshPlan {
  const knownIds = new Set(input.known.map((script) => script.id));
  const added = input.fetched.filter((script, index, all) => !knownIds.has(script.id) && all.findIndex((other) => other.id === script.id) === index);
  const options = mergeLiveResourceOptions(input.known, added);
  if (added.length === 0) {
    return { options, autoSelectId: null, announcement: input.manual ? "已更新清單，沒有新的互動腳本。" : "" };
  }
  if (added.length === 1 && !input.selectedId && input.canAutoSelect) {
    return { options, autoSelectId: added[0]!.id, announcement: `已更新清單，並自動選取新的互動腳本「${added[0]!.name}」。` };
  }
  const count = added.length === 1 ? `新增互動腳本「${added[0]!.name}」` : `新增 ${added.length} 個互動腳本`;
  return {
    options,
    autoSelectId: null,
    announcement: input.selectedId ? `已更新清單，${count}；目前選擇不變。` : `已更新清單，${count}，請自行選擇。`,
  };
}
