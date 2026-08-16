import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScheduledRuntimeMessage, ViewerRuntimeMessage } from "@/lib/live-chat-contract";
import { isRetryableChatStatus, LiveChatPanel, mergeViewerMessages, parseChatListPayload, parseViewerRuntimeMessage, postErrorMessage, sortScheduledMessages } from "./live-chat-panel";

const viewer = (id: string, createdAt: string, body = id): ViewerRuntimeMessage => ({
  id,
  source: "viewer",
  createdAt,
  body,
  actor: { name: "已驗證觀眾" },
});

const scheduled = (id: string, triggerSec: number): ScheduledRuntimeMessage => ({
  id,
  source: "scheduled",
  triggerSec,
  body: id,
  actor: { name: "官方助理", avatarUrl: null, label: "官方角色", presentationRole: "official" },
});

describe("LiveChatPanel message contracts", () => {
  it("deduplicates a POST result when a late poll includes the same viewer message", () => {
    const posted = viewer("viewer-2", "2026-08-17T10:00:01.000Z", "剛剛送出");
    const merged = mergeViewerMessages(
      [viewer("viewer-1", "2026-08-17T10:00:00.000Z"), posted],
      [viewer("viewer-1", "2026-08-17T10:00:00.000Z"), posted],
    );

    expect(merged).toHaveLength(2);
    expect(merged.map((message) => message.id)).toEqual(["viewer-1", "viewer-2"]);
  });

  it("keeps viewer ordering stable by timestamp then id", () => {
    const ordered = mergeViewerMessages([], [
      viewer("b", "2026-08-17T10:00:00.000Z"),
      viewer("earlier", "2026-08-17T09:59:59.000Z"),
      viewer("a", "2026-08-17T10:00:00.000Z"),
    ]);

    expect(ordered.map((message) => message.id)).toEqual(["earlier", "a", "b"]);
  });

  it("keeps scheduled messages separate and ordered by trigger second then id", () => {
    expect(sortScheduledMessages([scheduled("b", 20), scheduled("late", 21), scheduled("a", 20)]).map((message) => message.id))
      .toEqual(["a", "b", "late"]);
  });

  it("maps retryable, keyword, and ambiguous post outcomes to actionable text", () => {
    expect(postErrorMessage("keyword")).toContain("修改");
    expect(postErrorMessage("rate_limited")).toContain("太快");
    expect(postErrorMessage("retryable")).toContain("重試");
    expect(postErrorMessage("generic")).toContain("確認");
    expect(isRetryableChatStatus(429)).toBe(true);
    expect(isRetryableChatStatus(503)).toBe(true);
    expect(isRetryableChatStatus(409)).toBe(false);
  });

  it("accepts only server-projected viewer messages and never treats scripts as viewer posts", () => {
    const message = viewer("viewer-1", "2026-08-17T10:00:00.000Z");
    expect(parseViewerRuntimeMessage(message)).toEqual(message);
    expect(parseViewerRuntimeMessage(scheduled("script-1", 0))).toBeNull();
    expect(parseChatListPayload({
      messages: [message],
      viewer: { canPost: true, displayName: "已驗證觀眾", reason: null },
    })).toEqual({
      messages: [message],
      viewer: { canPost: true, displayName: "已驗證觀眾", reason: null },
    });
    expect(parseChatListPayload({
      messages: [scheduled("script-1", 0)],
      viewer: { canPost: true, displayName: "已驗證觀眾", reason: null },
    })).toBeNull();
  });

  it("renders scheduled messages accessibly without enabling viewer network controls", () => {
    const html = renderToStaticMarkup(
      <LiveChatPanel
        enabled={false}
        admissionStatus="admitted"
        vendorId="vendor-1"
        liveId="live-1"
        scheduledMessages={[scheduled("script-1", 0)]}
      />,
    );

    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("預設腳本");
    expect(html).not.toContain("<textarea");
  });

  it("keeps the composer visibly disabled until admission is ready", () => {
    const html = renderToStaticMarkup(
      <LiveChatPanel
        enabled
        admissionStatus="checking"
        vendorId="vendor-1"
        liveId="live-1"
        scheduledMessages={[]}
      />,
    );

    expect(html).toContain("直播連線尚未就緒");
    expect(html).toContain("<textarea");
    expect(html).toContain("disabled");
    expect(html).toContain("min-h-11");
  });
});
