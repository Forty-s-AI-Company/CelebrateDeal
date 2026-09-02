import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const formStatus = vi.hoisted(() => ({
  pending: false,
  data: null as FormData | null,
  action: null as string | ((formData: FormData) => void | Promise<void>) | null,
  method: null as "get" | "post" | null,
}));

vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return {
    ...reactDom,
    useFormStatus: () => formStatus,
  };
});

import { FormSubmitButton } from "./form-submit-button";
import { DangerButton, SubmitButton } from "./ui";

describe("FormSubmitButton", () => {
  beforeEach(() => {
    vi.useRealTimers();
    formStatus.pending = false;
    formStatus.data = null;
    formStatus.action = null;
    formStatus.method = null;
    vi.unstubAllGlobals();
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
    expect(markup).toContain('data-loading-indicator="true"');
  });

  it("preserves an explicit business-rule disabled state without announcing false pending work", () => {
    const markup = renderToStaticMarkup(
      <FormSubmitButton
        disabled
        pendingChildren="儲存中…"
        pendingMessage="正在儲存。"
      >
        儲存調整
      </FormSubmitButton>,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain("aria-disabled=\"true\"");
    expect(markup).toContain("aria-busy=\"false\"");
    expect(markup).toContain("儲存調整");
    expect(markup).not.toContain("儲存中…");
    expect(markup).not.toContain("正在儲存。");
  });

  it("forwards submitter name and value for multi-outcome server action forms", () => {
    const markup = renderToStaticMarkup(
      <FormSubmitButton
        name="status"
        value="published"
        pendingChildren="發布中…"
        pendingMessage="正在發布。"
      >
        發布
      </FormSubmitButton>,
    );

    expect(markup).toContain('name="status"');
    expect(markup).toContain('value="published"');
  });

  it("shows pending feedback only on the submitter selected by name and value", () => {
    formStatus.pending = true;
    formStatus.data = new FormData();
    formStatus.data.append("status", "published");

    const saveMarkup = renderToStaticMarkup(
      <FormSubmitButton name="status" value="draft" pendingChildren="儲存中…" pendingMessage="正在儲存。">
        儲存草稿
      </FormSubmitButton>,
    );
    const publishMarkup = renderToStaticMarkup(
      <FormSubmitButton name="status" value="published" pendingChildren="發布中…" pendingMessage="正在發布。">
        發布
      </FormSubmitButton>,
    );

    expect(saveMarkup).toContain('aria-disabled="true"');
    expect(saveMarkup).toContain('aria-busy="false"');
    expect(saveMarkup).toContain("儲存草稿");
    expect(saveMarkup).not.toContain("儲存中…");
    expect(saveMarkup).not.toContain("正在儲存。");
    expect(publishMarkup).toContain('aria-busy="true"');
    expect(publishMarkup).toContain("發布中…");
    expect(publishMarkup).toContain("正在發布。");
    expect(publishMarkup).toContain('data-loading-indicator="true"');
  });

  it("shows pending feedback only on the matching formAction in a mixed-action form", () => {
    const saveAction = vi.fn(async () => {});
    const deleteAction = vi.fn(async () => {});
    formStatus.pending = true;
    formStatus.data = new FormData();
    formStatus.action = deleteAction;

    const saveMarkup = renderToStaticMarkup(
      <FormSubmitButton formAction={saveAction} pendingChildren="儲存中…" pendingMessage="正在儲存。">
        儲存
      </FormSubmitButton>,
    );
    const deleteMarkup = renderToStaticMarkup(
      <FormSubmitButton formAction={deleteAction} pendingChildren="刪除中…" pendingMessage="正在刪除。">
        刪除
      </FormSubmitButton>,
    );

    expect(saveMarkup).toContain('aria-disabled="true"');
    expect(saveMarkup).toContain('aria-busy="false"');
    expect(saveMarkup).toContain("儲存");
    expect(saveMarkup).not.toContain("儲存中…");
    expect(saveMarkup).not.toContain("正在儲存。");
    expect(deleteMarkup).toContain('aria-busy="true"');
    expect(deleteMarkup).toContain("刪除中…");
    expect(deleteMarkup).toContain("正在刪除。");
  });

  it("prevents a destructive submit when the user declines the explicit confirmation", () => {
    const onClick = vi.fn();
    const confirm = vi.fn(() => false);
    const preventDefault = vi.fn();
    vi.stubGlobal("window", { confirm, setTimeout });
    const tree = FormSubmitButton({
      children: "刪除",
      pendingChildren: "刪除中…",
      pendingMessage: "正在刪除。",
      confirmMessage: "確定刪除？",
      onClick,
    }) as { props: { children: Array<{ type: unknown; props: { onClick?: (event: { preventDefault: () => void }) => void } }> } };
    const button = tree.props.children.find((child) => child.type === "button");

    button?.props.onClick?.({ preventDefault, currentTarget: { form: { checkValidity: () => true } } } as never);

    expect(confirm).toHaveBeenCalledWith("確定刪除？");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("explicitly submits the same button after an accepted confirmation", () => {
    const onClick = vi.fn();
    const confirm = vi.fn(() => true);
    const preventDefault = vi.fn();
    const requestSubmit = vi.fn();
    const form = { checkValidity: () => true, requestSubmit };
    const buttonElement = { form, formNoValidate: false };
    vi.stubGlobal("window", { confirm });
    const tree = FormSubmitButton({
      children: "重新產生 recovery codes",
      pendingChildren: "重新產生中…",
      pendingMessage: "正在重新產生 recovery codes。",
      confirmMessage: "確定重新產生？",
      onClick,
    }) as { props: { children: Array<{ type: unknown; props: { onClick?: (event: unknown) => void } }> } };
    const button = tree.props.children.find((child) => child.type === "button");

    button?.props.onClick?.({
      currentTarget: buttonElement,
      defaultPrevented: false,
      preventDefault,
    });

    expect(confirm).toHaveBeenCalledWith("確定重新產生？");
    expect(onClick).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestSubmit).toHaveBeenCalledWith(buttonElement);
  });

  it("lets native validation report invalid required fields before showing confirmation", () => {
    const onClick = vi.fn();
    const confirm = vi.fn(() => true);
    const preventDefault = vi.fn();
    const checkValidity = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const tree = FormSubmitButton({
      children: "確認付款",
      pendingChildren: "處理中…",
      pendingMessage: "正在處理。",
      confirmMessage: "確定送出？",
      onClick,
    }) as { props: { children: Array<{ type: unknown; props: { onClick?: (event: unknown) => void } }> } };
    const button = tree.props.children.find((child) => child.type === "button");

    button?.props.onClick?.({ preventDefault, currentTarget: { form: { checkValidity } } });

    expect(checkValidity).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps confirmation mandatory for a formNoValidate destructive submit on an invalid form", () => {
    const onClick = vi.fn();
    const confirm = vi.fn(() => false);
    const preventDefault = vi.fn();
    const checkValidity = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    const tree = FormSubmitButton({
      children: "刪除",
      pendingChildren: "刪除中…",
      pendingMessage: "正在刪除。",
      confirmMessage: "確定刪除？",
      formNoValidate: true,
      onClick,
    }) as { props: { children: Array<{ type: unknown; props: { onClick?: (event: unknown) => void } }> } };
    const button = tree.props.children.find((child) => child.type === "button");

    button?.props.onClick?.({
      preventDefault,
      currentTarget: { form: { checkValidity }, formNoValidate: true },
    });

    expect(checkValidity).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith("確定刪除？");
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("gives shared primary and destructive actions consistent pending feedback", () => {
    formStatus.pending = true;

    expect(renderToStaticMarkup(<SubmitButton />)).toContain("儲存中…");
    expect(renderToStaticMarkup(<DangerButton>全部登出</DangerButton>)).toContain("處理中…");
  });
});
