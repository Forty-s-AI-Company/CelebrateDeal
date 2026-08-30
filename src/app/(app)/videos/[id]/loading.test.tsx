import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VideoDetailLoading from "./loading";

describe("video detail loading state", () => {
  it("renders player and metadata skeletons without loading real media", () => {
    const html = renderToStaticMarkup(<VideoDetailLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在載入影片");
    expect(html).toContain("正在讀取影片資訊與播放狀態");
    expect(html).toContain('role="status"');
    expect(html).toContain("aspect-video");
    expect(html).not.toContain("<video");
  });
});
