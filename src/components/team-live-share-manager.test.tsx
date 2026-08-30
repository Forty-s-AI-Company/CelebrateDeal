import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reactMocks = vi.hoisted(() => ({
  useActionState: vi.fn(),
  stateCursor: 0,
  stateValues: [] as unknown[],
  effectCursor: 0,
  effects: [] as Array<{ deps: unknown[] | undefined; cleanup?: (() => void) | undefined }>,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: reactMocks.useActionState,
    useState: (initial: unknown) => {
      const index = reactMocks.stateCursor++;
      if (reactMocks.stateValues[index] === undefined) reactMocks.stateValues[index] = initial;
      return [reactMocks.stateValues[index], (next: unknown) => {
        const current = reactMocks.stateValues[index];
        reactMocks.stateValues[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(current) : next;
      }];
    },
    useEffect: (effect: () => (() => void) | undefined, deps?: unknown[]) => {
      const index = reactMocks.effectCursor++;
      const previous = reactMocks.effects[index];
      const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((value, position) => !Object.is(value, previous.deps?.[position]));
      if (!changed) return;
      previous?.cleanup?.();
      reactMocks.effects[index] = { deps, cleanup: effect() };
    },
  };
});

vi.mock("@/app/actions/team-funnel-live-share-actions", () => ({
  createTeamLiveShareAction: vi.fn(),
  disableTeamLiveShareAction: vi.fn(),
  initialTeamLiveShareActionState: { status: "idle", message: "" },
}));

import { TeamLiveShareManager, type TeamLiveSharePage } from "./team-live-share-manager";

type ElementNode = { type: unknown; props: Record<string, unknown> };
function isElementNode(value: unknown): value is ElementNode {
  return typeof value === "object" && value !== null && "type" in value && "props" in value;
}
function findElements(node: unknown, predicate: (element: ElementNode) => boolean): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!isElementNode(node)) return [];
  return [...(predicate(node) ? [node] : []), ...findElements(node.props.children, predicate)];
}
function textContent(node: unknown): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isElementNode(node) ? textContent(node.props.children) : "";
}

const activePage: TeamLiveSharePage = {
  id: "page-1",
  teamId: "team-1",
  slug: "summer-offer",
  headline: "夏季優惠",
  liveTitle: "八月直播",
  liveStatus: "live",
  targets: [{ membershipId: "membership-b", label: "B 夥伴", email: "b@example.test", activeShare: { expiresAt: null } }],
};

function renderManager(pages: TeamLiveSharePage[]) {
  reactMocks.stateCursor = 0;
  reactMocks.effectCursor = 0;
  return TeamLiveShareManager({ csrfToken: "csrf-test-token", pages });
}

function promoterMembershipId(form: ElementNode) {
  return findElements(form, (element) => element.type === "input" && element.props.name === "promoterMembershipId")[0]?.props.value;
}

beforeEach(() => {
  reactMocks.stateCursor = 0;
  reactMocks.stateValues = [];
  reactMocks.effectCursor = 0;
  reactMocks.effects = [];
  reactMocks.useActionState.mockImplementation((_: unknown, initialState: unknown) => [initialState, vi.fn(), false]);
});

describe("TeamLiveShareManager", () => {
  it("renders one-time sharing controls only for server-provided direct downlines", () => {
    const html = renderToStaticMarkup(<TeamLiveShareManager
      csrfToken="csrf-test-token"
      pages={[{
        id: "page-1",
        teamId: "team-1",
        slug: "summer-offer",
        headline: "夏季優惠",
        liveTitle: "八月直播",
        liveStatus: "live",
        targets: [{ membershipId: "membership-b", label: "B 夥伴", email: "b@example.test", activeShare: null }],
      }]}
    />);

    expect(html).toContain("Live 合作分享");
    expect(html).toContain("B 夥伴");
    expect(html).toContain("建立連結");
    expect(html).toContain('name="promoterMembershipId" value="membership-b"');
    expect(html).not.toContain("share=");
    expect(html).not.toContain("A 夥伴的其他 membership");
  });

  it("renders the empty-state boundary when no page is eligible", () => {
    const html = renderToStaticMarkup(<TeamLiveShareManager csrfToken="csrf-test-token" pages={[]} />);

    expect(html).toContain("目前沒有可分享的 scheduled、live 或可回放 Live");
    expect(html).not.toContain("建立連結");
  });

  it("renders the no-direct-downline state and active-share controls", () => {
    const html = renderToStaticMarkup(<TeamLiveShareManager
      csrfToken="csrf-test-token"
      pages={[
        {
          id: "page-scheduled",
          teamId: "team-1",
          slug: "scheduled-offer",
          headline: "即將開始",
          liveTitle: "九月直播",
          liveStatus: "scheduled",
          targets: [],
        },
        {
          id: "page-replay",
          teamId: "team-1",
          slug: "replay-offer",
          headline: "精彩回放",
          liveTitle: "八月直播",
          liveStatus: "ended",
          targets: [{
            membershipId: "membership-c",
            label: "C 夥伴",
            email: "c@example.test",
            activeShare: { expiresAt: "2030-01-02T00:00:00.000Z" },
          }],
        },
      ]}
    />);

    expect(html).toContain("即將直播");
    expect(html).toContain("精彩回放");
    expect(html).toContain("目前沒有可分享的直接下線夥伴");
    expect(html).toContain("重新產生");
    expect(html).toContain("停用");
    expect(html).toContain("已啟用");
    expect(html).toContain('name="promoterMembershipId" value="membership-c"');
  });

  it("renders the one-time success state returned by the create action", () => {
    reactMocks.useActionState
      .mockReturnValueOnce([{
        status: "success",
        message: "Live 分享連結已建立",
        shareUrl: "/live/replay?share=tls1.one-time",
        pageId: "page-1",
        promoterMembershipId: "membership-b",
      }, vi.fn(), false])
      .mockReturnValueOnce([{ status: "idle", message: "" }, vi.fn(), false]);

    const html = renderToStaticMarkup(<TeamLiveShareManager
      csrfToken="csrf-test-token"
      pages={[{
        id: "page-1",
        teamId: "team-1",
        slug: "summer-offer",
        headline: "夏季優惠",
        liveTitle: "八月直播",
        liveStatus: "ended",
        targets: [{ membershipId: "membership-b", label: "B 夥伴", email: "b@example.test", activeShare: null }],
      }]}
    />);

    expect(html).toContain('role="status"');
    expect(html).toContain("/live/replay?share=tls1.one-time");
    expect(html).toContain("複製連結");
    expect(html).toContain("完整 token 只在這次畫面顯示");
  });

  it("reports clipboard success and failure and keeps one cleanup-managed timer", async () => {
    let createState = {
      status: "success" as const,
      message: "Live 分享連結已建立",
      shareUrl: "/live/replay?share=tls1.one-time",
      pageId: "page-1",
      promoterMembershipId: "membership-b",
    };
    let actionCall = 0;
    reactMocks.useActionState.mockImplementation(() => (
      actionCall++ % 2 === 0
        ? [createState, vi.fn(), false]
        : [{ status: "idle", message: "" }, vi.fn(), false]
    ));
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    let timeoutCallback = () => {};
    const setTimeout = vi.fn((callback: () => void) => { timeoutCallback = callback; return 7; });
    const clearTimeout = vi.fn();
    const writeText = vi.fn(async () => {});
    globalScope.window = { setTimeout, clearTimeout };
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { clipboard: { writeText } } });

    try {
      let tree = renderManager([activePage]);
      let copyButton = findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製連結"))[0];
      (copyButton.props.onClick as () => void)();
      await Promise.resolve();
      await Promise.resolve();
      tree = renderManager([activePage]);
      copyButton = findElements(tree, (element) => element.type === "button" && textContent(element).includes("已複製"))[0];
      expect(copyButton).toBeDefined();
      expect(writeText).toHaveBeenCalledWith("/live/replay?share=tls1.one-time");
      expect(setTimeout).toHaveBeenCalledOnce();

      (copyButton.props.onClick as () => void)();
      await Promise.resolve();
      await Promise.resolve();
      renderManager([activePage]);
      expect(setTimeout).toHaveBeenCalledTimes(2);
      expect(clearTimeout).toHaveBeenCalledWith(7);

      createState = { ...createState, shareUrl: "/live/replay?share=tls1.second" };
      tree = renderManager([activePage]);
      expect(findElements(tree, (element) => element.type === "button" && textContent(element).includes("已複製"))).toHaveLength(0);
      expect(textContent(findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製連結"))[0])).toBe("複製連結");

      timeoutCallback();
      tree = renderManager([activePage]);
      expect(clearTimeout).toHaveBeenCalledTimes(2);
      expect(textContent(findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製連結"))[0])).toContain("複製連結");

      Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: {} });
      tree = renderManager([activePage]);
      (findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製連結"))[0].props.onClick as () => void)();
      await Promise.resolve();
      tree = renderManager([activePage]);
      expect(textContent(findElements(tree, (element) => element.props.role === "alert")[0])).toContain("瀏覽器無法複製分享連結");
      expect(textContent(findElements(tree, (element) => element.type === "button" && textContent(element).includes("複製失敗"))[0])).toBe("複製失敗，重試");
    } finally {
      reactMocks.effects.forEach((effect) => effect.cleanup?.());
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
      if (previousNavigatorDescriptor) Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
      else delete globalScope.navigator;
    }
  });

  it("scopes pending feedback to the submitted target while preventing concurrent actions", () => {
    reactMocks.useActionState
      .mockReturnValueOnce([{ status: "idle", message: "" }, vi.fn(), true])
      .mockReturnValueOnce([{ status: "idle", message: "" }, vi.fn(), false]);
    reactMocks.stateValues = [null, { kind: "create", key: "page-1:membership-b" }];
    const tree = renderManager([{
      ...activePage,
      targets: [
        activePage.targets[0],
        { membershipId: "membership-c", label: "C 夥伴", email: "c@example.test", activeShare: { expiresAt: null } },
      ],
    }]);
    const forms = findElements(tree, (element) => element.type === "form");
    const bCreate = forms.find((form) => promoterMembershipId(form) === "membership-b" && textContent(form).includes("建立中…"));
    const cCreate = forms.find((form) => promoterMembershipId(form) === "membership-c" && textContent(form).includes("重新產生"));
    const bButton = findElements(bCreate, (element) => element.type === "button")[0];
    const cButton = findElements(cCreate, (element) => element.type === "button")[0];

    expect(bCreate?.props["aria-busy"]).toBe(true);
    expect(cCreate?.props["aria-busy"]).toBe(false);
    expect(bButton.props["aria-busy"]).toBe(true);
    expect(cButton.props["aria-busy"]).toBe(false);
    expect(bButton.props.disabled).toBe(true);
    expect(cButton.props.disabled).toBe(true);
    expect(textContent(bCreate)).toContain("正在建立新的 Live 合作分享連結");
    expect(textContent(cCreate)).not.toContain("正在建立新的 Live 合作分享連結");
  });

  it("requires confirmation before disabling an active share", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const confirm = vi.fn(() => false);
    globalScope.window = { confirm };

    try {
      const tree = renderManager([activePage]);
      const disableForm = findElements(tree, (element) => element.type === "form" && textContent(element).includes("停用"))[0];
      const blocked = { preventDefault: vi.fn() };

      (disableForm.props.onSubmit as (event: typeof blocked) => void)(blocked);

      expect(confirm).toHaveBeenCalledWith("確定要停用 B 夥伴 的 Live 合作分享連結？既有連結會立即失效。");
      expect(blocked.preventDefault).toHaveBeenCalledOnce();

      confirm.mockReturnValue(true);
      const allowed = { preventDefault: vi.fn() };
      (disableForm.props.onSubmit as (event: typeof allowed) => void)(allowed);
      expect(allowed.preventDefault).not.toHaveBeenCalled();
    } finally {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
    }
  });

  it("confirms regeneration only when an old active share will be invalidated", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const previousWindow = globalScope.window;
    const confirm = vi.fn(() => false);
    globalScope.window = { confirm };

    try {
      let tree = renderManager([activePage]);
      let createForm = findElements(tree, (element) => element.type === "form" && textContent(element).includes("重新產生"))[0];
      const blocked = { preventDefault: vi.fn() };
      (createForm.props.onSubmit as (event: typeof blocked) => void)(blocked);
      expect(confirm).toHaveBeenCalledWith("重新產生會讓 B 夥伴 的舊分享連結立即失效。確定繼續？");
      expect(blocked.preventDefault).toHaveBeenCalledOnce();

      confirm.mockClear();
      tree = renderManager([{ ...activePage, targets: [{ ...activePage.targets[0], activeShare: null }] }]);
      createForm = findElements(tree, (element) => element.type === "form" && textContent(element).includes("建立連結"))[0];
      (createForm.props.onSubmit as (event: typeof blocked) => void)(blocked);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      if (previousWindow === undefined) delete globalScope.window;
      else globalScope.window = previousWindow;
    }
  });
});
