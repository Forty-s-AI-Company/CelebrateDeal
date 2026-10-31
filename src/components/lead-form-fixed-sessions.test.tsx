// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadForm, type LeadFormSession } from "./lead-form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** /form/[slug] with a fixed-session Live (指定場次) next to an ordinary one. */
const fixedLive: LeadFormSession = {
  id: "live-fixed",
  title: "多場次說明會",
  description: null,
  // Only the last session; the option must not show it.
  scheduledAt: "2030-10-31T12:00:00.000Z",
  status: "scheduled",
  fixedSessions: {
    liveId: "live-fixed",
    timeZone: "Asia/Taipei",
    registrationClosesAfterStartMinutes: 0,
    days: [
      { date: "2030-10-30", label: "10月30日（週三）", sessions: [{ id: "s-1400", startAt: "2030-10-30T06:00:00.000Z", timeLabel: "14:00", capacity: null, remaining: null, full: false }] },
      { date: "2030-10-31", label: "10月31日（週四）", sessions: [{ id: "s-2000", startAt: "2030-10-31T12:00:00.000Z", timeLabel: "20:00", capacity: 5, remaining: 2, full: false }] },
    ],
  },
};
const plainLive: LeadFormSession = { id: "live-plain", title: "一般直播", description: null, scheduledAt: "2030-11-05T12:00:00.000Z", status: "scheduled" };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); vi.unstubAllGlobals(); });

async function mount(sessions: LeadFormSession[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<LeadForm formId="form-1" fields={[{ key: "name", label: "姓名", required: true }, { key: "email", label: "Email", type: "email", required: true }]} sessions={sessions} submitLabel="送出報名" successMessage="已收到報名" />));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  return container;
}

const times = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('[data-live-session-times] [role="radio"]'));
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
async function fill(root: ParentNode) {
  for (const [name, value] of [["name", "測試"], ["email", "synthetic@example.invalid"]] as const) {
    const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
}
const submit = async (root: ParentNode) => { await act(async () => { root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("LeadForm with a fixed-session live (/form)", () => {
  it("describes the fixed-session option instead of its last session time and shows the picker only for it", async () => {
    const root = await mount([fixedLive, plainLive]);
    const options = Array.from(root.querySelectorAll("fieldset label"));
    expect(options[0]!.textContent).toContain("多個場次 · 2 個時段可報名");
    expect(options[0]!.textContent).not.toContain("20:00");
    expect(root.querySelector("[data-live-session-picker]")).not.toBeNull();
    await click(root.querySelector<HTMLInputElement>('input[name="liveId"][value="live-plain"]')!);
    expect(root.querySelector("[data-live-session-picker]")).toBeNull();
  });

  it("requires a session, sends liveSessionId and shows the server-confirmed session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, verificationRequired: true, liveSession: { id: "s-1400", startAt: "2030-10-30T06:00:00.000Z", label: "10月30日（週三） 14:00" } }));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount([fixedLive, plainLive]);
    await fill(root);
    await submit(root);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(root.textContent).toContain("請選擇要參加的場次。");
    await click(times(root)[0]!);
    await submit(root);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ formId: "form-1", liveId: "live-fixed", liveSessionId: "s-1400", payload: { name: "測試", email: "synthetic@example.invalid" } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).payload).not.toHaveProperty("liveSessionId");
    expect(root.textContent).toContain("你的場次：10月30日（週三） 14:00");
  });

  it("tells a registrant who already holds another session which one, and never sends a session for an ordinary live", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "Already registered for another session", startAt: "2030-10-31T12:00:00.000Z", sessionLabel: "10月31日（週四） 20:00" }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount([fixedLive, plainLive]);
    await fill(root);
    await click(times(root)[0]!);
    await submit(root);
    expect(root.textContent).toContain("你已報名 10月31日（週四） 20:00 場次");

    // Without the registration's own cookie the server sends no details.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Already registered for another session" }, { status: 409 })));
    await submit(root);
    expect(root.textContent).toContain("這個 Email 已經報名過其他場次，請查看確認信，或在原本報名的裝置上更換場次");

    const plain = vi.fn().mockResolvedValue(Response.json({ ok: true, verificationRequired: true }));
    vi.stubGlobal("fetch", plain);
    const other = await mount([plainLive]);
    await fill(other);
    await submit(other);
    expect(JSON.parse(plain.mock.calls[0]![1].body)).not.toHaveProperty("liveSessionId");
  });
});
