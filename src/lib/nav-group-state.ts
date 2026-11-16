/**
 * Remembers which sidebar groups the member expanded or collapsed. The state
 * is a per-browser convenience: every storage access is guarded, and when
 * localStorage is unavailable (private window, blocked site data) the choice
 * lives in memory for the page session and the defaults apply on reload.
 */
export const NAV_GROUP_STORAGE_KEY = "celebratedeal:nav-groups:v1";

/** Group label -> explicitly chosen open state. Groups never toggled are absent. */
export type NavGroupChoices = Readonly<Record<string, boolean>>;

const listeners = new Set<() => void>();
// Authoritative for this page session once the member toggles a group, even if persisting fails.
let memoryRaw: string | null = null;

export function parseNavGroupChoices(raw: string | null): NavGroupChoices {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const choices: Record<string, boolean> = {};
    for (const [label, open] of Object.entries(value)) {
      if (typeof open === "boolean") choices[label] = open;
    }
    return choices;
  } catch {
    return {};
  }
}

export function readNavGroupStorage(): string | null {
  if (memoryRaw !== null) return memoryRaw;
  try {
    return window.localStorage.getItem(NAV_GROUP_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeNavGroupChoice(label: string, open: boolean) {
  const next = JSON.stringify({ ...parseNavGroupChoices(readNavGroupStorage()), [label]: open });
  memoryRaw = next;
  try {
    window.localStorage.setItem(NAV_GROUP_STORAGE_KEY, next);
  } catch {
    // Keep the in-memory choice; the default applies again after a reload.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeNavGroupStorage(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== NAV_GROUP_STORAGE_KEY) return;
    memoryRaw = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Test helper: forget the in-memory choice. */
export function resetNavGroupMemory() {
  memoryRaw = null;
}
