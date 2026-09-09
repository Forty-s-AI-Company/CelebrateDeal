import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoursePlayer } from "@/components/course-player";

// Exercise the actual media handlers without relying on a browser's media clock.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (calculate: () => unknown) => calculate(),
}));

function find(node: ReactNode, type: string, text?: string): { [key: string]: unknown } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const result = find(child, type, text); if (result) return result; }
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === type && (text === undefined || node.props.children === text)) return node.props;
    return find(node.props.children, type, text);
  }
}

function playerTree(durationSeconds = 100) {
  return CoursePlayer({ vendorSlug: "academy", course: { id: "course-1", name: "Course" }, csrfToken: "synthetic", initialProgress: [], lessons: [{ id: "lesson-1", title: "Lesson", chapterTitle: "Chapter", position: 1, durationSeconds, videoUrl: "https://media.example.test/video.mp4" }] });
}
type MediaHandler = (event: { currentTarget: { currentTime: number; duration: number } }) => void;
const player = (durationSeconds = 100) => find(playerTree(durationSeconds), "video")!.onTimeUpdate as MediaHandler;

afterEach(() => vi.unstubAllGlobals());

describe("CoursePlayer progress requests", () => {
  it("coalesces the final checkpoint after playback crosses completion while a save is pending", async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    const update = player();
    update({ currentTarget: { currentTime: 75, duration: 100 } });
    for (let seconds = 90; seconds <= 100; seconds++) update({ currentTarget: { currentTime: seconds, duration: 100 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(Response.json({ lessonId: "lesson-1", watchedSeconds: 75, completedAt: null }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toMatchObject({ watchedSeconds: 100, markedComplete: false });
    resolve(Response.json({ lessonId: "lesson-1", watchedSeconds: 100, completedAt: new Date().toISOString() }));
    await new Promise((done) => setTimeout(done, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("flushes the final short interval and retains manual completion=%s", async (manual) => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    const tree = playerTree(200);
    const video = find(tree, "video")!;
    (video.onTimeUpdate as MediaHandler)({ currentTarget: { currentTime: 75, duration: 80 } });
    if (manual) (find(tree, "button", "標記完成")!.onClick as () => void)();
    (video.onEnded as MediaHandler)({ currentTarget: { currentTime: 80, duration: 80 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(Response.json({ lessonId: "lesson-1", watchedSeconds: 75, completedAt: null }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toMatchObject({ watchedSeconds: manual ? 200 : 80, markedComplete: manual });
    resolve(Response.json({ lessonId: "lesson-1", watchedSeconds: manual ? 200 : 80, completedAt: manual ? new Date().toISOString() : null }));
    await new Promise((done) => setTimeout(done, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps one request in flight at 90 percent and throttles subsequent events", async () => {
    let resolve!: (value: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    const update = player();
    for (let index = 0; index < 20; index++) update({ currentTarget: { currentTime: 90 + index / 100, duration: 100 } });
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(Response.json({ lessonId: "lesson-1", watchedSeconds: 90, completedAt: new Date().toISOString() }));
    await vi.waitFor(() => expect(fetch).toHaveResolved());
    update({ currentTarget: { currentTime: 91, duration: 100 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not flood progress requests when media duration differs from the lesson", async () => {
    const fetch = vi.fn(async () => Response.json({ lessonId: "lesson-1", watchedSeconds: 90, completedAt: null }));
    vi.stubGlobal("fetch", fetch);
    const update = player(200);
    for (let index = 0; index < 10; index++) {
      update({ currentTarget: { currentTime: 90 + index / 10, duration: 100 } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("handles network rejection without an unhandled promise rejection", async () => {
    const fetch = vi.fn(async () => { throw new Error("offline"); });
    vi.stubGlobal("fetch", fetch);
    const update = player();
    update({ currentTarget: { currentTime: 15, duration: 100 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    update({ currentTarget: { currentTime: 30, duration: 100 } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
