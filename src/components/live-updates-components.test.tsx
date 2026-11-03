// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveAdvancedInteractions } from "@/components/live-advanced-interactions";
import { LiveChatPanel } from "@/components/live-chat-panel";

const viewer = { canPost: false, displayName: null, reason: "verification_required" };
const message = (id: string) => ({ id, source: "viewer", createdAt: "2026-08-17T10:00:00.000Z", body: `留言${id}`, actor: { name: "王小明" } });

type Reply = { status?: number; body?: unknown };
const replies = { updates: [] as Reply[], open: [] as Reply[] };
const fetchMock = vi.fn();

function respond(reply: Reply | undefined) {
  const status = reply?.status ?? 200;
  return { ok: status < 400, status, json: async () => reply?.body ?? {} };
}

function chatBody(messages: string[], reset = false, cursor = "cursor") {
  return { cursor, nextPollMs: 3_000, chat: { messages: messages.map(message), reset, viewer } };
}

function pollRun(id: string, title: string) {
  return {
    id,
    title,
    eventType: "poll",
    status: "active",
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 120_000).toISOString(),
    metadata: { kind: "poll", question: title, durationSec: 120, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
    responseCount: 0,
    responded: false,
    ownValue: null,
    pollResults: [{ id: "a", label: "A", votes: 0, percentage: 0 }, { id: "b", label: "B", votes: 0, percentage: 0 }],
    winner: null,
    winnerIsViewer: false,
  };
}

let container: HTMLDivElement;
let root: Root;

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  replies.updates = [];
  replies.open = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init: { method?: string } = {}) => {
    if (String(url).startsWith("/api/live-updates")) {
      const next = replies.updates.length > 1 ? replies.updates.shift() : replies.updates[0];
      return respond(next);
    }
    if (init.method === "POST") return respond(replies.open[0]);
    return respond({ status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LiveChatPanel on the merged poll", () => {
  const panel = (props: Partial<Parameters<typeof LiveChatPanel>[0]> = {}) => (
    <LiveChatPanel enabled admissionStatus="admitted" vendorId="v1" liveId="l1" scheduledMessages={[]} {...props} />
  );

  it("merges increments and lets reset:true replace the whole list", async () => {
    replies.updates = [
      { body: chatBody(["a", "b", "c"]) },
      { body: chatBody(["d"]) },
      { body: chatBody(["x", "y"], true) },
    ];
    await act(async () => { root.render(panel()); });
    await flush();
    expect(container.textContent).toContain("留言a");
    expect(container.textContent).toContain("留言c");

    await flush(3_000);
    expect(container.textContent).toContain("留言a");
    expect(container.textContent).toContain("留言d");

    await flush(3_000);
    expect(container.textContent).toContain("留言x");
    expect(container.textContent).toContain("留言y");
    for (const gone of ["留言a", "留言b", "留言c", "留言d"]) expect(container.textContent).not.toContain(gone);
  });

  it("pauses and calls onAdmissionInvalid once on 401, then resumes after re-admission", async () => {
    const onAdmissionInvalid = vi.fn();
    replies.updates = [{ status: 401 }];
    await act(async () => { root.render(panel({ onAdmissionInvalid })); });
    await flush();
    expect(onAdmissionInvalid).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("直播連線或留言資格已失效");
    const callsAtLoss = fetchMock.mock.calls.length;
    await flush(30_000);
    expect(fetchMock.mock.calls.length).toBe(callsAtLoss);

    // The parent re-admits the viewer: checking, then admitted again.
    replies.updates = [{ body: chatBody(["back"]) }];
    await act(async () => { root.render(panel({ onAdmissionInvalid, admissionStatus: "checking" })); });
    await flush();
    await act(async () => { root.render(panel({ onAdmissionInvalid, admissionStatus: "admitted" })); });
    await flush();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAtLoss);
    expect(container.textContent).toContain("留言back");
    expect(container.textContent).not.toContain("直播連線或留言資格已失效");
    expect(onAdmissionInvalid).toHaveBeenCalledTimes(1);
  });
});

describe("LiveAdvancedInteractions on the merged poll", () => {
  const scriptedEvent = { id: "script-1", eventType: "poll", title: "Script", triggerSec: 0, metadata: { kind: "poll", durationSec: 120 } };
  const interactions = (props: Partial<Parameters<typeof LiveAdvancedInteractions>[0]> = {}) => (
    <LiveAdvancedInteractions vendorId="v1" liveId="l1" currentSeconds={0} events={[scriptedEvent]} enabled {...props} />
  );

  it("shows the opened scheduled run ahead of the polled run, and falls back to the polled run when the window ends", async () => {
    replies.updates = [{ body: { cursor: null, nextPollMs: 2_000, interactions: { runs: [pollRun("manual", "手動投票")], spotlight: null } } }];
    replies.open = [{ body: { run: pollRun("scripted", "排定投票") } }];
    await act(async () => { root.render(interactions()); });
    await flush();
    expect(container.textContent).toContain("排定投票");
    expect(container.textContent).not.toContain("手動投票");

    // A later poll tick must not replace the scheduled run.
    await flush(2_000);
    expect(container.textContent).toContain("排定投票");
    expect(container.textContent).not.toContain("手動投票");

    // The scheduled window closes: the polled run shows at once, without waiting for another poll.
    const getsBefore = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/live-updates")).length;
    await act(async () => { root.render(interactions({ currentSeconds: 500 })); });
    expect(container.textContent).toContain("手動投票");
    expect(container.textContent).not.toContain("排定投票");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/live-updates")).length).toBeGreaterThanOrEqual(getsBefore);
  });

  it("falls back to the polled run when opening the scheduled event fails", async () => {
    replies.updates = [{ body: { cursor: null, nextPollMs: 2_000, interactions: { runs: [pollRun("manual", "手動投票")], spotlight: null } } }];
    replies.open = [{ status: 409 }];
    await act(async () => { root.render(interactions()); });
    await flush();
    expect(container.textContent).toContain("手動投票");
  });
});
