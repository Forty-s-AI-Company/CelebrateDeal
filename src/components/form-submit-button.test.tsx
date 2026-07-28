import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const formStatus = vi.hoisted(() => ({ pending: false }));

vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return {
    ...reactDom,
    useFormStatus: () => ({ pending: formStatus.pending }),
  };
});

import { FormSubmitButton } from "./form-submit-button";
import { DangerButton, SubmitButton } from "./ui";

describe("FormSubmitButton", () => {
  beforeEach(() => {
    formStatus.pending = false;
  });

  it("renders the enabled action without a false loading announcement", () => {
    const markup = renderToStaticMarkup(
      <FormSubmitButton
        pendingChildren="建立中…"
        pendingMessage="正在建立。"
        className="test-button"
      >
        建立直播間
      </FormSubmitButton>,
    );

    expect(markup).toContain("建立直播間");
    expect(markup).not.toContain("建立中…");
    expect(markup).not.toContain("正在建立。");
    expect(markup).toContain("aria-disabled=\"false\"");
    expect(markup).not.toContain(" disabled=\"\"");
  });

  it("disables duplicate submission and announces pending work", () => {
    formStatus.pending = true;
    const markup = renderToStaticMarkup(
      <FormSubmitButton
        pendingChildren="建立中…"
        pendingMessage="正在建立。"
      >
        建立直播間
      </FormSubmitButton>,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain("aria-disabled=\"true\"");
    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toContain("建立中…");
    expect(markup).toContain("正在建立。");
    expect(markup).toContain("aria-live=\"polite\"");
  });

  it("gives shared primary and destructive actions consistent pending feedback", () => {
    formStatus.pending = true;

    expect(renderToStaticMarkup(<SubmitButton />)).toContain("儲存中…");
    expect(renderToStaticMarkup(<DangerButton>全部登出</DangerButton>)).toContain("處理中…");
  });
});
