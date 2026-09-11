import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPresenterBackground } from "./presenter-background";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  send(data: unknown) { this.onmessage?.({ data }); }
}
const bitmap = () => ({ width: 640, height: 360, close: vi.fn() });
const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
beforeEach(() => {
  vi.useFakeTimers(); FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker); vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap()));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("loads only on enable, bounds capture, keeps one in flight and closes replaced frames", async () => {
  const state = vi.fn(); const controller = createPresenterBackground(state);
  expect(FakeWorker.instances).toHaveLength(0);
  controller.setEnabled(true);
  const worker = FakeWorker.instances[0]!;
  expect(state).toHaveBeenLastCalledWith("loading"); worker.send({ type: "ready" });
  controller.capture(video); controller.capture(video); await Promise.resolve();
  expect(createImageBitmap).toHaveBeenCalledExactlyOnceWith(video, { resizeWidth: 640, resizeHeight: 360 });
  const first = bitmap(); worker.send({ type: "frame", bitmap: first, durationMs: 20 });
  expect(controller.frame()).toBe(first); expect(state).toHaveBeenLastCalledWith("active");
  const second = bitmap(); worker.send({ type: "frame", bitmap: second, durationMs: 20 });
  expect(first.close).toHaveBeenCalledOnce();
  controller.setEnabled(false);
  expect(second.close).toHaveBeenCalledOnce(); expect(worker.terminate).toHaveBeenCalledOnce();
  expect(controller.frame()).toBeUndefined(); expect(state).toHaveBeenLastCalledWith("off");
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["error", "timeout", "unsupported", "slow"])("falls back on %s and can retry", cause => {
  const state = vi.fn(); const controller = createPresenterBackground(state);
  if (cause === "unsupported") vi.stubGlobal("Worker", undefined);
  controller.setEnabled(true);
  const worker = FakeWorker.instances[0];
  if (cause === "error") worker!.onerror!();
  if (cause === "timeout") vi.advanceTimersByTime(20001);
  if (cause === "slow") {
    worker!.send({ type: "ready" });
    for (let i = 0; i < 10; i++) worker!.send({ type: "frame", bitmap: bitmap(), durationMs: 151 });
  }
  expect(state).toHaveBeenLastCalledWith(cause === "timeout" || cause === "error" ? "failed" : cause);
  expect(controller.frame()).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  vi.stubGlobal("Worker", FakeWorker); controller.setEnabled(true);
  expect(state).toHaveBeenLastCalledWith("loading"); controller.stop();
});

it("closes late capture and late worker replies after stop without resurrecting processing", async () => {
  let resolve!: (value: ReturnType<typeof bitmap>) => void;
  vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise(done => { resolve = done; })));
  const state = vi.fn(); const controller = createPresenterBackground(state);
  controller.setEnabled(true); const worker = FakeWorker.instances[0]!;
  worker.send({ type: "ready" }); controller.capture(video); controller.stop();
  const late = bitmap(); resolve(late); await Promise.resolve();
  expect(late.close).toHaveBeenCalledOnce();
  const reply = bitmap(); worker.send({ type: "frame", bitmap: reply, durationMs: 1 });
  expect(reply.close).toHaveBeenCalledOnce(); expect(state).toHaveBeenLastCalledWith("off");
  expect(worker.postMessage).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});

it("times out stalled frame processing", () => {
  const state = vi.fn(); const controller = createPresenterBackground(state);
  controller.setEnabled(true); FakeWorker.instances[0]!.send({ type: "ready" });
  controller.capture(video); vi.advanceTimersByTime(2001);
  expect(state).toHaveBeenLastCalledWith("slow"); expect(controller.frame()).toBeUndefined();
});
