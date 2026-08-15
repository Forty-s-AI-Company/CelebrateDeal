import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyLiveStudioDraft, type LiveStudioDraftEnvelope } from "@/lib/live-studio-draft";
import { LiveStudioDraftClientError } from "@/lib/live-studio-draft-client";
import {
  handleLiveStudioDraftBeforeUnload,
  LiveStudioDraftSaveQueue,
  useLiveStudioDraft,
  type LiveStudioDraftSaveState,
  type LiveStudioDraftSaveStatus,
} from "./use-live-studio-draft";

type HookEffect = () => void | (() => void);
type HookHarnessRuntime = {
  effects: HookEffect[];
  refs: Array<{ current: unknown }>;
  refIndex: number;
  states: unknown[];
  stateIndex: number;
  stateInitialized: boolean[];
};

const reactHookHarness = vi.hoisted(() => {
  let runtime: HookHarnessRuntime | null = null;
  return {
    setRuntime(nextRuntime: HookHarnessRuntime) {
      runtime = nextRuntime;
    },
    clearRuntime() {
      runtime = null;
    },
    useCallback<T>(callback: T) {
      return callback;
    },
    useEffect(effect: HookEffect) {
      if (!runtime) throw new Error("Hook runtime is not active.");
      runtime.effects.push(effect);
    },
    useRef<T>(initialValue: T) {
      if (!runtime) throw new Error("Hook runtime is not active.");
      const ref = runtime.refs[runtime.refIndex] ?? { current: initialValue };
      runtime.refs[runtime.refIndex] = ref;
      runtime.refIndex += 1;
      return ref as { current: T };
    },
    useState<T>(initialValue: T | (() => T)) {
      if (!runtime) throw new Error("Hook runtime is not active.");
      const stateIndex = runtime.stateIndex;
      runtime.stateIndex += 1;
      if (!runtime.stateInitialized[stateIndex]) {
        runtime.states[stateIndex] = typeof initialValue === "function"
          ? (initialValue as () => T)()
          : initialValue;
        runtime.stateInitialized[stateIndex] = true;
      }
      const setState = (nextState: T | ((currentState: T) => T)) => {
        if (!runtime) return;
        const currentState = runtime.states[stateIndex] as T;
        runtime.states[stateIndex] = typeof nextState === "function"
          ? (nextState as (currentState: T) => T)(currentState)
          : nextState;
      };
      return [runtime.states[stateIndex] as T, setState] as const;
    },
  };
});

vi.mock("react", () => ({
  useCallback: reactHookHarness.useCallback,
  useEffect: reactHookHarness.useEffect,
  useRef: reactHookHarness.useRef,
  useState: reactHookHarness.useState,
}));

const liveDraftClientMock = vi.hoisted(() => {
  class MockLiveStudioDraftClientError extends Error {
    constructor(public readonly code: string) {
      super(`Live Studio draft request failed (${code}).`);
      this.name = "LiveStudioDraftClientError";
    }
  }

  return {
    LiveStudioDraftClientError: MockLiveStudioDraftClientError,
    serializeLiveStudioDraft: vi.fn(() => ({})),
    saveLiveStudioDraft: vi.fn(async ({ draftId, revision, payload }: {
      draftId: string;
      revision: number | null;
      payload: unknown;
    }) => ({
      id: draftId || "draft-1",
      revision: (revision ?? 0) + 1,
      updatedAt: "2026-08-15T00:00:00.000Z",
      payload,
    })),
  };
});

vi.mock("@/lib/live-studio-draft-client", () => liveDraftClientMock);

function LiveStudioDraftHarness(initialDraft?: LiveStudioDraftEnvelope) {
  const runtime: HookHarnessRuntime = {
    effects: [],
    refs: [],
    refIndex: 0,
    states: [],
    stateIndex: 0,
    stateInitialized: [],
  };
  const formRef = { current: {} as HTMLFormElement };
  reactHookHarness.setRuntime(runtime);
  const result = useLiveStudioDraft({
    activeStep: 0,
    csrfToken: "csrf-token",
    formRef,
    initialDraft,
    liveId: "live-1",
  });
  const cleanups = runtime.effects
    .map((effect) => effect())
    .filter((cleanup): cleanup is () => void => typeof cleanup === "function");

  return {
    result,
    unmount() {
      [...cleanups].reverse().forEach((cleanup) => cleanup());
      reactHookHarness.clearRuntime();
    },
  };
}

function createWindowListenerMock() {
  type Listener = (event: BeforeUnloadEvent) => void;
  const listeners = new Map<string, Set<Listener>>();
  const addEventListener = vi.fn((type: string, listener: Listener) => {
    const registered = listeners.get(type) ?? new Set<Listener>();
    registered.add(listener);
    listeners.set(type, registered);
  });
  const removeEventListener = vi.fn((type: string, listener: Listener) => {
    listeners.get(type)?.delete(listener);
  });
  const dispatchEvent = vi.fn((event: Event) => {
    for (const listener of listeners.get(event.type) ?? []) {
      listener(event as unknown as BeforeUnloadEvent);
    }
    return true;
  });
  const windowMock = { addEventListener, removeEventListener, dispatchEvent } as unknown as Window;
  vi.stubGlobal("window", windowMock);
  return { addEventListener, removeEventListener, dispatchEvent };
}

function createBeforeUnloadEvent() {
  return {
    type: "beforeunload",
    preventDefault: vi.fn(),
    returnValue: "initial",
  } as unknown as BeforeUnloadEvent;
}

afterEach(() => {
  reactHookHarness.clearRuntime();
  vi.unstubAllGlobals();
});

function envelope(
  id: string,
  revision: number,
  payload = emptyLiveStudioDraft(),
): LiveStudioDraftEnvelope {
  return {
    id,
    revision,
    payload,
    updatedAt: `2026-08-08T01:0${revision}:00.000Z`,
  };
}

describe("LiveStudioDraftSaveQueue", () => {
  it("never aborts an in-flight revision and saves the newest queued payload next", async () => {
    let resolveFirst: ((value: LiveStudioDraftEnvelope) => void) | undefined;
    let resolveSecond: ((value: LiveStudioDraftEnvelope) => void) | undefined;
    const firstSave = new Promise<LiveStudioDraftEnvelope>((resolve) => { resolveFirst = resolve; });
    const secondSave = new Promise<LiveStudioDraftEnvelope>((resolve) => { resolveSecond = resolve; });
    const save = vi.fn().mockReturnValueOnce(firstSave).mockReturnValueOnce(secondSave);
    const transitions: LiveStudioDraftSaveState[] = [];
    const queue = new LiveStudioDraftSaveQueue({
      liveId: "",
      save,
      onTransition: (state) => transitions.push(state),
    });
    const firstPayload = { ...emptyLiveStudioDraft(), title: "第一版" };
    const newestPayload = { ...emptyLiveStudioDraft(), title: "第二版" };
    queue.enqueue(firstPayload);
    await Promise.resolve();
    queue.markDirty(newestPayload);
    const completed = queue.flush(newestPayload);
    resolveFirst?.(envelope("draft-1", 1, firstPayload));
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(2);
    expect(transitions.some((state) => state.status === "saved")).toBe(false);
    expect(transitions.at(-1)).toMatchObject({ status: "saving", draftId: "draft-1", revision: 1 });
    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ draftId: "", revision: null, payload: firstPayload }));
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ draftId: "draft-1", revision: 1, payload: newestPayload }));

    resolveSecond?.(envelope("draft-1", 2, newestPayload));
    await expect(completed).resolves.toBe(true);
    expect(transitions.at(-1)).toMatchObject({ status: "saved", draftId: "draft-1", revision: 2 });
    expect(queue.currentClaim()).toEqual({ draftId: "draft-1", revision: 2 });
    expect(queue.matches(newestPayload)).toBe(true);
    expect(queue.matches(firstPayload)).toBe(false);
  });

  it("keeps dirty when a newer local payload is scheduled before the debounce flush", async () => {
    let resolveFirst: ((value: LiveStudioDraftEnvelope) => void) | undefined;
    const firstSave = new Promise<LiveStudioDraftEnvelope>((resolve) => { resolveFirst = resolve; });
    const firstPayload = { ...emptyLiveStudioDraft(), title: "第一版" };
    const newestPayload = { ...emptyLiveStudioDraft(), title: "第二版" };
    const save = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce(envelope("draft-1", 2, newestPayload));
    const transitions: LiveStudioDraftSaveState[] = [];
    const queue = new LiveStudioDraftSaveQueue({
      liveId: "",
      save,
      onTransition: (state) => transitions.push(state),
    });

    const firstDrain = queue.flush(firstPayload);
    await Promise.resolve();
    queue.markDirty(newestPayload);
    resolveFirst?.(envelope("draft-1", 1, firstPayload));

    await expect(firstDrain).resolves.toBe(true);
    expect(transitions.at(-1)).toMatchObject({ status: "dirty", draftId: "draft-1", revision: 1 });
    expect(queue.matches(firstPayload)).toBe(false);
    expect(queue.matches(newestPayload)).toBe(false);

    await expect(queue.flush(newestPayload)).resolves.toBe(true);
    expect(transitions.at(-1)).toMatchObject({ status: "saved", draftId: "draft-1", revision: 2 });
    expect(queue.matches(newestPayload)).toBe(true);
  });

  it("matches only the latest local payload after that payload is saved", async () => {
    const firstPayload = { ...emptyLiveStudioDraft(), title: "第一版" };
    const newestPayload = { ...emptyLiveStudioDraft(), title: "第二版" };
    const save = vi.fn().mockResolvedValue(envelope("draft-1", 2, newestPayload));
    const queue = new LiveStudioDraftSaveQueue({
      liveId: "",
      initialDraft: envelope("draft-1", 1, firstPayload),
      save,
      onTransition: vi.fn(),
    });

    queue.markDirty(newestPayload);
    expect(queue.matches(firstPayload)).toBe(false);
    expect(queue.matches(newestPayload)).toBe(false);

    await expect(queue.flush(newestPayload)).resolves.toBe(true);
    expect(queue.matches(firstPayload)).toBe(false);
    expect(queue.matches(newestPayload)).toBe(true);
  });

  it("locks after an optimistic conflict instead of overwriting or retrying", async () => {
    const save = vi.fn().mockRejectedValue(new LiveStudioDraftClientError("draft_conflict"));
    const transitions: LiveStudioDraftSaveState[] = [];
    const queue = new LiveStudioDraftSaveQueue({
      liveId: "live-1",
      initialDraft: envelope("draft-1", 3),
      save,
      onTransition: (state) => transitions.push(state),
    });

    await expect(queue.flush(emptyLiveStudioDraft())).resolves.toBe(false);
    await expect(queue.flush({ ...emptyLiveStudioDraft(), title: "不可覆蓋" })).resolves.toBe(false);

    expect(save).toHaveBeenCalledOnce();
    expect(transitions.at(-1)).toMatchObject({ status: "conflict", revision: 3 });
    expect(queue.currentClaim()).toEqual({ draftId: "draft-1", revision: 3 });
  });

  it("allows an explicit retry after a transient network failure", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new LiveStudioDraftClientError("network_error"))
      .mockResolvedValueOnce(envelope("draft-1", 1));
    const queue = new LiveStudioDraftSaveQueue({ liveId: "", save, onTransition: vi.fn() });

    await expect(queue.flush(emptyLiveStudioDraft())).resolves.toBe(false);
    await expect(queue.flush({ ...emptyLiveStudioDraft(), title: "重試" })).resolves.toBe(true);

    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe("Live Studio draft beforeunload guard", () => {
  const blockingStatuses: LiveStudioDraftSaveStatus[] = ["dirty", "saving", "error", "conflict"];
  const safeStatuses: LiveStudioDraftSaveStatus[] = ["idle", "saved"];

  it.each(blockingStatuses)("blocks navigation while status is %s", (status) => {
    const preventDefault = vi.fn();
    const event = { preventDefault, returnValue: "initial" } as unknown as BeforeUnloadEvent;

    handleLiveStudioDraftBeforeUnload(event, status);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });

  it.each(safeStatuses)("does not block navigation while status is %s", (status) => {
    const preventDefault = vi.fn();
    const event = { preventDefault, returnValue: "initial" } as unknown as BeforeUnloadEvent;

    handleLiveStudioDraftBeforeUnload(event, status);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBe("initial");
  });
});

describe("Live Studio draft hook beforeunload lifecycle", () => {
  it("registers the listener, blocks dirty dispatch, and removes it on unmount", () => {
    const browser = createWindowListenerMock();
    const hook = LiveStudioDraftHarness();

    expect(browser.addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    hook.result.scheduleSave();
    const dirtyEvent = createBeforeUnloadEvent();
    browser.dispatchEvent(dirtyEvent as unknown as Event);

    expect(dirtyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dirtyEvent.returnValue).toBe("");

    hook.unmount();
    expect(browser.removeEventListener).toHaveBeenCalledWith(
      "beforeunload",
      browser.addEventListener.mock.calls[0][1],
    );

    const afterUnmountEvent = createBeforeUnloadEvent();
    browser.dispatchEvent(afterUnmountEvent as unknown as Event);
    expect(afterUnmountEvent.preventDefault).not.toHaveBeenCalled();
    expect(afterUnmountEvent.returnValue).toBe("initial");
  });

  it("does not block after the hook transitions from dirty to saved", async () => {
    const browser = createWindowListenerMock();
    const hook = LiveStudioDraftHarness();

    hook.result.scheduleSave();
    const dirtyEvent = createBeforeUnloadEvent();
    browser.dispatchEvent(dirtyEvent as unknown as Event);
    expect(dirtyEvent.preventDefault).toHaveBeenCalledOnce();

    await expect(hook.result.saveNow()).resolves.toEqual({ draftId: "draft-1", revision: 1 });

    const savedEvent = createBeforeUnloadEvent();
    browser.dispatchEvent(savedEvent as unknown as Event);
    expect(savedEvent.preventDefault).not.toHaveBeenCalled();
    expect(savedEvent.returnValue).toBe("initial");

    hook.unmount();
  });
});
