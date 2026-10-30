// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { FunnelPageDocumentRenderer, type FunnelSubmissionContext } from "./funnel-page-document-renderer";
import { FunnelWebinarExperience, type WebinarExperienceResource } from "./funnel-webinar-experience";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { dateChipLabel, rememberChosenLiveSession, firstAvailableDate, LIVE_SESSION_STORAGE_PREFIX, readChosenLiveSession, type LiveSessionsData } from "./live-session-picker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = (id: string, timeLabel: string, extra: Partial<{ capacity: number | null; remaining: number | null; full: boolean }> = {}) =>
  ({ id, startAt: `2026-11-01T${timeLabel}:00+08:00`, timeLabel, capacity: 50, remaining: 12, full: false, ...extra });

function sessionsData(): LiveSessionsData {
  return {
    liveId: "live-1",
    timeZone: "Asia/Taipei",
    registrationClosesAfterStartMinutes: 0,
    days: [
      { date: "2026-11-01", label: "11月1日（週日）", sessions: [session("s-full-a", "14:00", { remaining: 0, full: true }), session("s-full-b", "19:00", { remaining: 0, full: true })] },
      { date: "2026-11-02", label: "11月2日（週一）", sessions: [session("s-1400", "14:00", { remaining: 3 }), session("s-1900", "19:00", { capacity: null, remaining: null }), session("s-2100", "21:00", { remaining: 0, full: true })] },
      { date: "2026-11-03", label: "11月3日（週二）", sessions: [session("s-next", "10:00")] },
    ],
  };
}

const submission = (liveSessions?: LiveSessionsData, extra: Partial<FunnelSubmissionContext> = {}): FunnelSubmissionContext => ({
  form: { id: "lead-form", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出報名", successMessage: "已收到報名。" },
  landingPageId: "lp-1",
  liveId: "live-1",
  ...(liveSessions ? { liveSessions } : {}),
  ...extra,
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); vi.unstubAllGlobals(); window.sessionStorage.clear(); });
beforeEach(() => window.sessionStorage.clear());

async function mount(context: FunnelSubmissionContext, template = "leads-checklist-minimal") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<FunnelPageDocumentRenderer document={previewFunnelTemplate(template)} viewport="desktop" mode="preview" submission={context} publicSurface />));
  cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
  // The template has a hero form and a closing form, each with its own picker; drive the first.
  return container.querySelector("form")!;
}

const dates = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('[data-live-session-dates] [role="radio"]'));
const times = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('[data-live-session-times] [role="radio"]'));
const click = async (element: HTMLElement) => { await act(async () => element.click()); };
const key = async (element: HTMLElement, name: string) => { await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); }); };
const form = (root: HTMLFormElement) => root;
const fill = async (root: HTMLFormElement) => {
  for (const [name, value] of [["name", "測試"], ["email", "synthetic@example.invalid"]] as const) {
    const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
};
const submit = async (root: HTMLFormElement) => { await act(async () => { form(root).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("session picker helpers", () => {
  it("preselects the first date that still has a seat and formats chip labels", () => {
    expect(firstAvailableDate(sessionsData().days)).toBe("2026-11-02");
    expect(firstAvailableDate([])).toBeNull();
    expect(dateChipLabel(sessionsData().days[1]!)).toEqual({ numeric: "11/2", weekday: "週一" });
  });
});

describe("session picker on the public registration form", () => {
  it("server-renders the initial dates and slots, with full slots disabled and labelled", () => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={previewFunnelTemplate("leads-checklist-minimal")} viewport="desktop" mode="preview" submission={submission(sessionsData())} publicSurface />);
    expect(html).toContain('role="radiogroup" aria-label="選擇日期"');
    expect(html).toContain("11/2");
    expect(html).toContain("額滿");
    expect(html).toContain('name="liveSessionId"');
    expect(html).toContain("剩 3 位");
  });

  it("renders no picker for a live without sessions", async () => {
    const root = await mount(submission());
    expect(root.querySelector("[data-live-session-picker]")).toBeNull();
    expect(root.querySelector('input[name="liveSessionId"]')).toBeNull();
  });

  it("preselects the first available date and lists that day's slots; full slots are visible but disabled", async () => {
    const root = await mount(submission(sessionsData()));
    const chips = dates(root);
    expect(chips).toHaveLength(3);
    expect(chips.map((chip) => chip.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    const slots = times(root);
    expect(slots.map((slot) => slot.textContent)).toEqual(["14:00剩 3 位", "19:00", "21:00額滿"]);
    expect(slots[2]!.disabled).toBe(true);
    expect(slots.some((slot) => slot.getAttribute("aria-checked") === "true")).toBe(false);
    // Each target is at least 44px (min-h-11 / min-w-11).
    expect([...chips, ...slots].every((button) => button.className.includes("min-h-11") && button.className.includes("min-w-11"))).toBe(true);
    // A fully booked date stays selectable but is labelled.
    expect(chips[0]!.getAttribute("aria-label")).toContain("已額滿");
  });

  it("changes the day's slots, announces the change and clears a selection from another day", async () => {
    const root = await mount(submission(sessionsData()));
    await click(times(root)[0]!);
    expect(times(root)[0]!.getAttribute("aria-checked")).toBe("true");
    await click(dates(root)[2]!);
    expect(times(root).map((slot) => slot.textContent)).toEqual(["10:00剩 12 位"]);
    expect(times(root)[0]!.getAttribute("aria-checked")).toBe("false");
    expect(root.querySelector('input[name="liveSessionId"]')!.getAttribute("value")).toBe("");
    expect(root.querySelector('[role="status"][aria-live="polite"]')!.textContent).toBe("11月3日（週二）共 1 個時段，1 個可報名。");
  });

  it("supports arrow, Home and End keys with roving focus on dates and skips full slots in times", async () => {
    const root = await mount(submission(sessionsData()));
    const chips = dates(root);
    expect(chips.map((chip) => chip.tabIndex)).toEqual([-1, 0, -1]);
    await key(chips[1]!, "ArrowRight");
    expect(dates(root)[2]!.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(dates(root)[2]);
    await key(dates(root)[2]!, "ArrowRight");
    expect(dates(root)[0]!.getAttribute("aria-checked")).toBe("true");
    await key(dates(root)[0]!, "End");
    expect(dates(root)[2]!.getAttribute("aria-checked")).toBe("true");
    await key(dates(root)[2]!, "ArrowLeft");
    expect(dates(root)[1]!.getAttribute("aria-checked")).toBe("true");

    await key(times(root)[0]!, "ArrowDown");
    expect(times(root)[1]!.getAttribute("aria-checked")).toBe("true");
    await key(times(root)[1]!, "ArrowDown");
    // 21:00 is full, so the focus wraps to the first open slot.
    expect(times(root)[0]!.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(times(root)[0]);
  });

  it("blocks submit with an inline error when no slot is chosen", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission(sessionsData()));
    await fill(root);
    await submit(root);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(root.querySelector('[data-live-session-picker] [role="alert"]')!.textContent).toBe("請選擇要參加的場次。");
    expect(document.activeElement).toBe(times(root)[0]);
  });

  it("posts liveSessionId with the registration and remembers the choice for the thank-you step", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, verificationRequired: true }));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission(sessionsData()));
    await fill(root);
    await click(times(root)[1]!);
    await submit(root);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/form-submissions");
    expect(JSON.parse(options.body)).toMatchObject({ formId: "lead-form", liveId: "live-1", liveSessionId: "s-1900", payload: { name: "測試", email: "synthetic@example.invalid" } });
    expect(readChosenLiveSession("live-1")).toMatchObject({ label: "11月2日（週一） 19:00" });
  });

  it("does not send liveSessionId for a live without sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, verificationRequired: true }));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission());
    await fill(root);
    await submit(root);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty("liveSessionId");
  });

  it("shows the full-or-closed message on 409, refreshes the list and clears the stale choice", async () => {
    const refreshed = sessionsData();
    refreshed.days[1]!.sessions[1] = session("s-1900", "19:00", { remaining: 0, full: true });
    const fetchMock = vi.fn((input: string) => Promise.resolve(input.startsWith("/api/live-sessions") ? Response.json(refreshed) : Response.json({ error: "Live session full" }, { status: 409 })));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission(sessionsData()));
    await fill(root);
    await click(times(root)[1]!);
    await submit(root);
    expect(root.textContent).toContain("此時段已額滿或已截止，請改選其他時段");
    const refresh = (fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>).find(([input]) => String(input).startsWith("/api/live-sessions"))!;
    expect(String(refresh[0])).toContain("liveId=live-1");
    expect(refresh[1]?.headers).toEqual({ "X-CelebrateDeal-Client": "web" });
    expect(times(root).map((slot) => slot.textContent)).toEqual(["14:00剩 3 位", "19:00額滿", "21:00額滿"]);
    expect(times(root)[1]!.disabled).toBe(true);
    expect(root.querySelector('input[name="liveSessionId"]')!.getAttribute("value")).toBe("");
    // The visitor can still re-submit after choosing another slot.
    await click(times(root)[0]!);
    expect(times(root)[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("shows a friendly message on the per-session rate limit (429) without refreshing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "Too many requests" }, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission(sessionsData()));
    await fill(root);
    await click(times(root)[0]!);
    await submit(root);
    expect(root.textContent).toContain("報名次數過多，請稍後再試");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("asks for a session when the server reports a missing selection (400)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Fixed session selection required" }, { status: 400 })));
    const root = await mount(submission(sessionsData()));
    await fill(root);
    await click(times(root)[0]!);
    await submit(root);
    expect(root.textContent).toContain("請選擇要參加的場次。");
    // An ordinary validation 400 keeps the generic message.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Invalid payload" }, { status: 400 })));
    await submit(root);
    expect(root.textContent).toContain("請確認必填欄位");
  });

  it("treats a duplicate-email 409 like a taken seat: message plus refresh", async () => {
    const fetchMock = vi.fn((input: string) => Promise.resolve(input.startsWith("/api/live-sessions") ? Response.json(sessionsData()) : Response.json({ error: "Live session closed" }, { status: 409 })));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission(sessionsData()));
    await fill(root);
    await click(times(root)[0]!);
    await submit(root);
    expect(root.textContent).toContain("此時段已額滿或已截止，請改選其他時段");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/live-sessions"))).toBe(true);
  });

  it("a 404 from the sessions refresh means nothing is available: clear message and no submit", async () => {
    const fetchMock = vi.fn((input: string) => Promise.resolve(input.startsWith("/api/live-sessions") ? Response.json({ error: "Live sessions unavailable" }, { status: 404 }) : Response.json({ error: "Live session full" }, { status: 409 })));
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission(sessionsData()));
    await fill(root);
    await click(times(root)[0]!);
    await submit(root);
    expect(root.textContent).toContain("目前沒有可報名的場次");
    expect(dates(root)).toHaveLength(0);
    const calls = fetchMock.mock.calls.length;
    await submit(root);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("explains when every session is gone and blocks submit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const root = await mount(submission({ ...sessionsData(), days: [] }));
    expect(root.textContent).toContain("目前沒有可報名的場次");
    await fill(root);
    await submit(root);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("themes the picker from the template's submit button instead of fixed colours", async () => {
    const root = await mount(submission(sessionsData()));
    const picker = root.querySelector<HTMLElement>("[data-live-session-picker]")!;
    expect(picker.getAttribute("style") ?? "").toContain("--live-session-accent");
    expect(times(root)[0]!.getAttribute("style") ?? "").not.toMatch(/#[0-9a-f]{3,6}\b/iu);
  });

  it("native-submit forms (webinar designs) carry liveSessionId in the POST and block a missing choice", async () => {
    const root = await mount(submission(sessionsData(), { nativeSubmit: true, redirectTo: "/lp/x/thanks" }));
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => { form(root).dispatchEvent(submitEvent); });
    expect(submitEvent.defaultPrevented).toBe(true);
    await click(times(root)[0]!);
    expect(root.querySelector('input[name="liveSessionId"]')!.getAttribute("value")).toBe("s-1400");
    expect(window.sessionStorage.getItem(`${LIVE_SESSION_STORAGE_PREFIX}live-1`)).toBeNull();
  });
});

describe("thank-you step", () => {
  it("shows the date and time the visitor chose, and a neutral line when nothing is remembered", async () => {
    const flow = createGoalFunnelStepPages({ id: "f", name: "Webinar", goal: "webinar", domain: "slug" })!;
    flow.flow.webinar = { timezone: "Asia/Taipei", startsAt: "2030-01-01T01:00:00.000Z", endsAt: "2030-01-01T02:00:00.000Z", replayEndsAt: "2030-01-02T02:00:00.000Z" };
    const resource: WebinarExperienceResource = {
      live: { id: "live-1", slug: "live", videoId: "v", videoTitle: "影片" },
      form: { id: "form", fields: [{ key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出", successMessage: "ok" },
      liveSessions: sessionsData(),
    };
    const mountThanks = async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      await act(async () => root.render(<FunnelWebinarExperience state={flow} slug="slug" stepId="webinar_thank_you" resource={resource} />));
      cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
      return container;
    };
    expect((await mountThanks()).textContent).toContain("確認信會寫明開始時間");
    rememberChosenLiveSession("live-1", "11月2日（週一） 19:00", "2026-11-02T19:00:00+08:00");
    const withChoice = await mountThanks();
    expect(withChoice.textContent).toContain("你選擇的場次：11月2日（週一） 19:00");
    expect(withChoice.querySelector("time")!.getAttribute("datetime")).toBe("2026-11-02T19:00:00+08:00");
  });
});
