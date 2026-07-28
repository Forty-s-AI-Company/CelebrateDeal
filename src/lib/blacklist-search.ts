export type SearchableBlacklistEntry = {
  identifier: string;
  reason: string;
  notes: string | null;
};

export function filterBlacklistEntries<T extends SearchableBlacklistEntry>(
  entries: T[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return entries;

  return entries.filter((entry) =>
    [entry.identifier, entry.reason, entry.notes ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}
