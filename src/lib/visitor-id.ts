export const VISITOR_ID_STORAGE_KEY = "celebrate_visitor_id";

export type VisitorIdStorage = Pick<Storage, "getItem" | "setItem">;
export type RandomIdFactory = () => string;
export type VisitorIdStorageFactory = () => VisitorIdStorage | null | undefined;

export function visitorIdStorageKey(scope: string) {
  const normalizedScope = scope.trim();
  return normalizedScope
    ? `${VISITOR_ID_STORAGE_KEY}:${encodeURIComponent(normalizedScope)}`
    : null;
}

/**
 * Gets the anonymous visitor ID persisted for one vendor scope when storage is available.
 * Storage access is intentionally optional because privacy settings can block it.
 */
export function getOrCreateVisitorId(
  scope: string,
  createRandomId: RandomIdFactory,
  getStorage: VisitorIdStorageFactory,
): string {
  const storageKey = visitorIdStorageKey(scope);
  if (!storageKey) return createRandomId();

  let storage: VisitorIdStorage | null | undefined;

  try {
    storage = getStorage();
    const existingId = storage?.getItem(storageKey);
    if (existingId?.trim()) return existingId;
  } catch {
    // Browser privacy controls can block localStorage reads or access entirely.
  }

  const visitorId = createRandomId();

  try {
    storage?.setItem(storageKey, visitorId);
  } catch {
    // The generated ID remains usable for this page even when persistence fails.
  }

  return visitorId;
}
