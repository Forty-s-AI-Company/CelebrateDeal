import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LivePrivateConversationPanel } from "./live-private-conversation-panel";
import { LiveViewerPrivateChat } from "./live-viewer-private-chat";
import { LiveInstructorPrivateChat } from "./live-instructor-private-chat";
it("starts viewer chat with an honest authorization check and disabled composer", () => {
  const html = renderToStaticMarkup(<LivePrivateConversationPanel mode="viewer" vendorId="tenant-a" liveId="live-a" />);
  expect(html).toContain("正在確認私訊權限"); expect(html).toContain("只有這位觀眾與授權講師");
  expect(html).toContain('aria-label="私人訊息"'); expect(html).toContain('disabled=""');
  expect(html).not.toContain("合成講師回覆");
});
it("does not mount the private reader before the viewer expands the panel", () => {
  const html = renderToStaticMarkup(<LiveViewerPrivateChat vendorId="tenant-a" liveId="live-a" />);
  expect(html).toContain("<summary"); expect(html).toContain("講師私訊");
  expect(html).not.toContain("正在確認私訊權限"); expect(html).not.toContain("<textarea");
});
it("keeps an empty instructor inbox explicit instead of inventing conversations", () => {
  const html = renderToStaticMarkup(<LiveInstructorPrivateChat vendorId="tenant-a" liveId="live-a" initialPage={{ conversations: [], nextCursor: null }} />);
  expect(html).toContain("目前沒有觀眾私訊"); expect(html).toContain("選擇觀眾即可"); expect(html).not.toContain("<textarea");
});
it("renders only authorized initial names and keeps the conversation pending until its API check", () => {
  const html = renderToStaticMarkup(<LiveInstructorPrivateChat vendorId="tenant-a" liveId="live-a" initialPage={{ conversations: [{ submissionId: "viewer-a", displayName: "合成觀眾" }], nextCursor: "opaque-next-page" }} />);
  expect(html).toContain("合成觀眾"); expect(html).toContain('aria-pressed="true"'); expect(html).toContain("載入更多對話");
  expect(html).toContain("正在確認私訊權限"); expect(html).not.toContain("viewer-a");
});
it("remounts draft and retry state when the selected conversation changes", () => {
  const first = LivePrivateConversationPanel({ mode: "instructor", liveId: "live-a", submissionId: "viewer-a" });
  const other = LivePrivateConversationPanel({ mode: "instructor", liveId: "live-a", submissionId: "viewer-b" });
  expect(first.key).not.toBe(other.key);
});
