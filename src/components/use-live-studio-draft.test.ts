import { describe, expect, it, vi } from "vitest";
import { emptyLiveStudioDraft, type LiveStudioDraftEnvelope } from "@/lib/live-studio-draft";
import { LiveStudioDraftClientError } from "@/lib/live-studio-draft-client";
import { LiveStudioDraftSaveQueue, type LiveStudioDraftSaveState } from "./use-live-studio-draft";

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
    const firstSave = new Promise<LiveStudioDraftEnvelope>((resolve) => { resolveFirst = resolve; });
    const save = vi.fn().mockReturnValueOnce(firstSave);
    const transitions: LiveStudioDraftSaveState[] = [];
    const queue = new LiveStudioDraftSaveQueue({
      liveId: "",
      save,
      onTransition: (state) => transitions.push(state),
    });
    const firstPayload = { ...emptyLiveStudioDraft(), title: "第一版" };
    const newestPayload = { ...emptyLiveStudioDraft(), title: "第二版" };
    save.mockResolvedValueOnce(envelope("draft-1", 2, newestPayload));

    queue.enqueue(firstPayload);
    await Promise.resolve();
    const completed = queue.flush(newestPayload);
    resolveFirst?.(envelope("draft-1", 1, firstPayload));

    await expect(completed).resolves.toBe(true);
    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ draftId: "", revision: null, payload: firstPayload }));
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ draftId: "draft-1", revision: 1, payload: newestPayload }));
    expect(transitions.at(-1)).toMatchObject({ status: "saved", draftId: "draft-1", revision: 2 });
    expect(queue.currentClaim()).toEqual({ draftId: "draft-1", revision: 2 });
    expect(queue.matches(newestPayload)).toBe(true);
    expect(queue.matches(firstPayload)).toBe(false);
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
