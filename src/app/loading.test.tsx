import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLoading from "./loading";

describe("root loading state", () => {
  it("renders an accessible, non-blocking skeleton", () => {
    const html = renderToStaticMarkup(<RootLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("正在載入頁面");
    expect(html).toContain("animate-pulse");
  });
});
