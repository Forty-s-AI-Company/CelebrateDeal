// Hydration waits shared by the staging browser smoke runner and the local
// Playwright suite. Kept free of import.meta and Node-only imports so the
// Playwright TypeScript loader can import it from tests/e2e.

export const HYDRATION_TIMEOUT_MS = 20_000;
// Plain CSS (no Playwright `:visible`): it also runs inside the page through querySelector.
export const MOBILE_NAV_MORE_BUTTON = 'nav[aria-label="行動版主要導覽"] button[aria-haspopup="dialog"]';
export const MOBILE_NAV_PRODUCTS_LINK = '[role="dialog"][aria-label="更多功能"] a[href="/products"]';

/**
 * True once React has attached its props to the element (React DOM stores them under a
 * `__reactProps$<random>` key during hydration). Runs in the page; returns only a boolean.
 */
export function elementHydratedInPage(selector) {
  const element = document.querySelector(selector);
  return Boolean(element) && Object.keys(element).some((key) => key.startsWith("__reactProps$"));
}

/**
 * 2026-11-18 runs 44231762166 and 44232725695 (bfd240ba): the mobile 「更多」 click landed
 * on server HTML before React hydrated the app shell, so the drawer never opened and the
 * products link wait timed out (NAV_MORE_PRODUCTS_LINK). The button is a React state toggle
 * with no HTML fallback; the app shell's client bundle was unchanged between the passing
 * and failing builds. Wait for React to own the button before clicking it.
 */
export async function waitForMobileNavHydration(page, timeout = HYDRATION_TIMEOUT_MS) {
  await page.waitForFunction(elementHydratedInPage, MOBILE_NAV_MORE_BUTTON, { timeout });
}
