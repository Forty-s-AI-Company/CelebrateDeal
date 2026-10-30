/**
 * Whether a navigation entry is the current page. An entry is active on its
 * own path, anything below it, and any `activePrefixes` (used by the 設定 hub
 * entry so every /settings/* and /billing/* page highlights it).
 */
export function isNavPathActive(pathname: string | null, href: string, activePrefixes?: readonly string[]) {
  if (!pathname) return false;
  const matches = (prefix: string) => pathname === prefix || (prefix !== "/dashboard" && pathname.startsWith(`${prefix}/`));
  return matches(href) || Boolean(activePrefixes?.some(matches));
}
