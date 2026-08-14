import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pending: false,
  setPending: vi.fn(),
  submittedRef: { current: false },
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: () => [state.pending, state.setPending] as const,
    useRef: () => state.submittedRef,
  };
});

import { NativePostForm } from "./native-post-form";

const props = {
  action: "/api/form-submissions/verify",
  idleLabel: "確認 Email 並完成報名",
  pendingLabel: "確認中…",
  pendingMessage: "正在確認 Email 並完成報名，請勿重複送出。",
  children: <input type="hidden" name="token" value="synthetic-token" />,
};

describe("NativePostForm", () => {
  beforeEach(() => {
    state.pending = false;
    state.setPending.mockClear();
    state.submittedRef.current = false;
  });

  it("preserves native POST progressive enhancement and its payload", () => {
    const html = renderToStaticMarkup(<NativePostForm {...props} />);

    expect(html).toContain('action="/api/form-submissions/verify"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="token" value="synthetic-token"');
    expect(html).toContain("確認 Email 並完成報名");
    expect(html).toContain('aria-disabled="false"');
  });

  it("allows the first native submit and synchronously blocks a duplicate", () => {
    const tree = NativePostForm(props) as {
      props: { onSubmit: (event: { preventDefault: () => void }) => void };
    };
    const firstPreventDefault = vi.fn();
    const secondPreventDefault = vi.fn();

    tree.props.onSubmit({ preventDefault: firstPreventDefault });
    tree.props.onSubmit({ preventDefault: secondPreventDefault });

    expect(state.setPending).toHaveBeenCalledExactlyOnceWith(true);
    expect(firstPreventDefault).not.toHaveBeenCalled();
    expect(secondPreventDefault).toHaveBeenCalledExactlyOnceWith();
  });

  it("disables, shows a loader, and announces pending navigation", () => {
    state.pending = true;
    const html = renderToStaticMarkup(<NativePostForm {...props} />);

    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-loading-indicator="true"');
    expect(html).toContain("確認中…");
    expect(html).toContain("正在確認 Email 並完成報名，請勿重複送出。");
  });
});
