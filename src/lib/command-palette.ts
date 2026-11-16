import type { NavGroup } from "@/lib/app-navigation";

/** One page the command palette can open. Built only from the navigation data. */
export type PaletteEntry = {
  href: string;
  label: string;
  /** Sidebar group (or 設定 section) shown next to the label. */
  group: string;
  description?: string;
};

/**
 * Flattens the already role/feature-filtered sidebar groups and settings hub
 * groups into palette entries. Callers pass the output of `navigationForRole`
 * and `settingsHubForRole`, so the palette can never list a page the sidebar
 * would hide. A page reachable from both lists appears once.
 */
export function paletteEntriesFromNavigation(navGroups: readonly NavGroup[], hubGroups: readonly NavGroup[]): PaletteEntry[] {
  const seen = new Set<string>();
  const entries: PaletteEntry[] = [];
  const add = (groupLabel: string, group: NavGroup) => {
    for (const item of group.items) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      entries.push({ href: item.href, label: item.label, group: groupLabel, ...(item.description ? { description: item.description } : {}) });
    }
  };
  for (const group of navGroups) add(group.label, group);
  for (const group of hubGroups) add(`設定 › ${group.label}`, group);
  return entries;
}

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}

/**
 * Plain substring search (Chinese or Latin, case and width insensitive,
 * spaces ignored). Label matches rank before group matches, which rank before
 * description matches; ties keep navigation order. An empty query lists every
 * entry.
 */
export function searchPaletteEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  const needle = normalize(query);
  if (!needle) return [...entries];
  const ranked: Array<{ entry: PaletteEntry; rank: number; index: number }> = [];
  entries.forEach((entry, index) => {
    const label = normalize(entry.label);
    let rank: number;
    if (label.startsWith(needle)) rank = 0;
    else if (label.includes(needle)) rank = 1;
    else if (normalize(entry.group).includes(needle)) rank = 2;
    else if (entry.description && normalize(entry.description).includes(needle)) rank = 3;
    else return;
    ranked.push({ entry, rank, index });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ entry }) => entry);
}
