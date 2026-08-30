import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VideosLoading from "./loading";

describe("videos loading state", () => {
  it("renders the video list shape and status announcement", () => {
    const html = renderToStaticMarkup(<VideosLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在載入影片庫");
    expect(html).toContain("正在整理影片與處理狀態");
    expect(html).toContain('role="status"');
    expect((html.match(/animate-pulse/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
