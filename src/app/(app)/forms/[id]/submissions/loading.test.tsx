import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FormSubmissionsLoading from "./loading";

describe("form submissions loading state", () => {
  it("announces loading and exposes a stable skeleton", () => {
    const html = renderToStaticMarkup(<FormSubmissionsLoading />);
    expect(html).toContain("role=\"status\"");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("正在載入報名名單");
    expect(html).toContain("animate-pulse");
  });
});
