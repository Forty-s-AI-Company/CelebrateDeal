import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout from "./layout";

describe("RootLayout announcement mount", () => {
  it("mounts one announcement center after children and checkout", () => {
    const html = renderToStaticMarkup(
      <RootLayout
        checkout={<aside data-testid="checkout-slot">checkout</aside>}
      >
        <main data-testid="children-slot">children</main>
      </RootLayout>,
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
