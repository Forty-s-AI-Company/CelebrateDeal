import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ProtectedAppLoading from "./loading";

describe("protected app loading state", () => {
  it("renders a workspace skeleton without a full-screen blocker", () => {
    const html = renderToStaticMarkup(<ProtectedAppLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在載入工作區");
    expect(html).toContain('role="status"');
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("fixed inset-0");
  });
});
