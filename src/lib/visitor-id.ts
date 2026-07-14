export const VISITOR_ID_STORAGE_KEY = "celebrate_visitor_id";

export type VisitorIdStorage = Pick<Storage, "getItem" | "setItem">;
export type RandomIdFactory = () => string;
export type VisitorIdStorageFactory = () => VisitorIdStorage | null | undefined;

/**
 * Gets the anonymous visitor ID persisted by the browser when storage is available.
 * Storage access is intentionally optional because privacy settings can block it.
 */
export function getOrCreateVisitorId(
  createRandomId: RandomIdFactory,
  getStorage: VisitorIdStorageFactory,
): string {
  let storage: VisitorIdStorage | null | undefined;

  try {
    storage = getStorage();
    const existingId = storage?.getItem(VISITOR_ID_STORAGE_KEY);
    if (existingId?.trim()) return existingId;
  } catch {
    // Browser privacy controls can block localStorage reads or access entirely.
  }

  const visitorId = createRandomId();

  try {
    storage?.setItem(VISITOR_ID_STORAGE_KEY, visitorId);
  } catch {
    // The generated ID remains usable for this page even when persistence fails.
  }

  return visitorId;
}
