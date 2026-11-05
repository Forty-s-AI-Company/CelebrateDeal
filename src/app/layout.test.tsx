import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));

import RootLayout from "./layout";
import { useCspNonce } from "@/components/csp-nonce";

function NonceProbe() {
  return <output data-testid="nonce">{useCspNonce() ?? "none"}</output>;
}

beforeEach(() => {
  requestHeaders.value = new Headers();
});

describe("RootLayout announcement mount", () => {
  it("mounts one announcement center after children and checkout", async () => {
    const html = renderToStaticMarkup(
      await RootLayout({
        checkout: <aside data-testid="checkout-slot">checkout</aside>,
        children: <main data-testid="children-slot">children</main>,
      }),
    );

    const childrenIndex = html.indexOf('data-testid="children-slot"');
    const checkoutIndex = html.indexOf('data-testid="checkout-slot"');
    const launcherIndex = html.indexOf('data-testid="announcement-center-launcher"');
    expect(childrenIndex).toBeGreaterThanOrEqual(0);
    expect(checkoutIndex).toBeGreaterThan(childrenIndex);
    expect(launcherIndex).toBeGreaterThan(checkoutIndex);
    expect(html.match(/data-testid="announcement-center-launcher"/g)).toHaveLength(1);
  });
});

describe("RootLayout CSP nonce (F-156)", () => {
  it("provides the proxy's nonce to client components", async () => {
    requestHeaders.value = new Headers({ "x-nonce": "AAAAAAAAAAAAAAAAAAAAAA==" });
    const html = renderToStaticMarkup(await RootLayout({ checkout: null, children: <NonceProbe /> }));
    expect(html).toContain('<output data-testid="nonce">AAAAAAAAAAAAAAAAAAAAAA==</output>');
  });

  it("ignores a missing or malformed nonce", async () => {
    for (const value of [null, "short", "AAAAAAAAAAAAAAAAAAAAAA==\"><script>"]) {
      requestHeaders.value = new Headers(value === null ? {} : { "x-nonce": value });
      const html = renderToStaticMarkup(await RootLayout({ checkout: null, children: <NonceProbe /> }));
      expect(html).toContain('<output data-testid="nonce">none</output>');
    }
  });
});
