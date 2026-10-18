import { isValidElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoursePlayer } from "@/components/course-player";
import {renderToStaticMarkup} from "react-dom/server";
import { getCsrfToken, verifyCsrfToken } from "@/lib/csrf";
const hydration = vi.hoisted(() => ({ active: true }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));

it("renders English empty-course copy without translating merchant course data",()=>{
 const html=renderToStaticMarkup(CoursePlayer({vendorSlug:"teacher",course:{id:"course_a",name:"商家課程"},lessons:[],initialProgress:[],csrfToken:"synthetic",locale:"en"}));
 expect(html).toContain("Course content is being prepared");
 expect(html).not.toContain("課程內容準備中");
});

// Exercise the actual media handlers without relying on a browser's media clock.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (calculate: () => unknown) => calculate(),
  useSyncExternalStore: () => hydration.active,
}));

function find(node: ReactNode, type: string, text?: string): { [key: string]: unknown } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const result = find(child, type, text); if (result) return result; }
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === type && (text === undefined || node.props.children === text)) return node.props;
    return find(node.props.children, type, text);
  }
}

function playerTree(durationSeconds = 100, csrfToken = "synthetic") {
  return CoursePlayer({ vendorSlug: "academy", course: { id: "course-1", name: "Course" }, csrfToken, initialProgress: [], lessons: [{ id: "lesson-1", title: "Lesson", chapterTitle: "Chapter", position: 1, durationSeconds, videoUrl: "https://media.example.test/video.mp4" }] });
}
type MediaHandler = (event: { currentTarget: { currentTime: number; duration: number } }) => void;
const player = (durationSeconds = 100) => find(playerTree(durationSeconds), "video")!.onTimeUpdate as MediaHandler;

afterEach(() => { hydration.active = true; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("CoursePlayer progress requests", () => {
  it("keeps translated controls behind the hydration barrier", () => {
    const translatedPlayer = () => CoursePlayer({ vendorSlug: "academy", locale: "en", course: { id: "course-1", name: "Course" }, csrfToken: "synthetic", initialProgress: [], lessons: [{ id: "lesson-1", title: "Lesson", chapterTitle: "Chapter", position: 1, durationSeconds: 100, videoUrl: null }] });
    hydration.active = false;
    expect(find(translatedPlayer(), "button", "Mark complete")?.disabled).toBe(true);
    expect(find(translatedPlayer(), "button")?.disabled).toBe(true);
    hydration.active = true;
    expect(find(translatedPlayer(), "button", "Mark complete")?.disabled).toBe(false);
  });

  it("keeps both lesson controls disabled until the client handlers are attached", () => {
    hydration.active = false;
    expect(find(playerTree(), "button", "標記完成")?.disabled).toBe(true);
    expect(find(playerTree(), "button")?.disabled).toBe(true);
    hydration.active = true;
    expect(find(playerTree(), "button", "標記完成")?.disabled).toBe(false);
    expect(find(playerTree(), "button")?.disabled).toBe(false);
  });
  it.each([false, true])("refreshes an expired token and resends the same checkpoint, manual=%s", async (manual) => {
    vi.useFakeTimers();
    vi.stubEnv("CSRF_SECRET", "synthetic-course-player-renewal-secret-32-bytes");
    const initialToken = await getCsrfToken();
    const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(async (_url, options) => {
      if (options.method === "GET") return Response.json({ csrfToken: await getCsrfToken() });
      const headers = new Headers(options.headers);
      if (!await verifyCsrfToken(headers.get("x-csrf-token"))) return Response.json({ error: "forbidden" }, { status: 403 });
      return Response.json({ lessonId: "lesson-1", watchedSeconds: manual ? 100 : 90, completedAt: new Date().toISOString() });
    });
    vi.stubGlobal("fetch", fetch);
    const tree = playerTree(100, initialToken);
    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 1);
    await expect(verifyCsrfToken(initialToken)).resolves.toBe(false);
    if (manual) (find(tree, "button", "標記完成")!.onClick as () => void)();
    else (find(tree, "video")!.onTimeUpdate as MediaHandler)({ currentTarget: { currentTime: 90, duration: 100 } });
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]![1]).toMatchObject({ method: "GET", cache: "no-store" });
    expect(fetch.mock.calls[2]![1].body).toBe(fetch.mock.calls[0]![1].body);
    const refreshedToken = new Headers(fetch.mock.calls[2]![1].headers).get("x-csrf-token");
    expect(refreshedToken).not.toBe(initialToken);
    await expect(verifyCsrfToken(refreshedToken)).resolves.toBe(true);
  });

  it("does not retry indefinitely when refreshed-token submission is still denied", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 403 })).mockResolvedValueOnce(Response.json({ csrfToken: "fresh" })).mockResolvedValueOnce(Response.json({}, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    player()({ currentTarget: { currentTime: 90, duration: 100 } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await new Promise((done) => setTimeout(done, 0));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
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
