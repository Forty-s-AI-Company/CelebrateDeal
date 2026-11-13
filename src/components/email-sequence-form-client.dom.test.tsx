// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/email-sequence-actions", () => ({ saveEmailSequenceAction: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

import { EmailSequenceFormClient } from "./email-sequence-form-client";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

const lives = [{ id: "live-1", title: "春季直播", startLabel: "2026年12月10日 下午8:00" }];
const templates = [{ id: "template-1", name: "第一封", usable: true }, { id: "template-2", name: "舊信", usable: false }];

function form(props: Partial<Parameters<typeof EmailSequenceFormClient>[0]> = {}) {
  return (
    <EmailSequenceFormClient
      csrfField={<input type="hidden" name="_csrf" value="synthetic" />}
      lives={lives}
      templates={templates}
      initialDraft={{ name: "", liveId: "live-1", steps: [] }}
      {...props}
    />
  );
}

const submit = () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("儲存序列"));
const addStep = () => [...container.querySelectorAll("button")].find((button) => button.textContent === "新增一封");
const stepCount = () => container.querySelector<HTMLInputElement>('input[name="stepCount"]')?.value;

describe("EmailSequenceFormClient", () => {
  it("cannot be submitted before hydration (server HTML has the save button disabled)", () => {
    const html = renderToString(form());
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*儲存序列/u);
    expect(html).toContain("頁面載入完成後才能儲存");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>新增一封/u);
  });

  it("enables saving once hydrated and keeps the step list and its count in sync", async () => {
    await act(async () => { root.render(form()); });
    expect(submit()?.disabled).toBe(false);
    expect(container.textContent).not.toContain("頁面載入完成後才能儲存");
    expect(stepCount()).toBe("1");
    expect(container.querySelector('select[name="steps.0.messageTemplateId"]')?.textContent).toContain("舊信（已停用）");

    await act(async () => { addStep()?.click(); });
    expect(stepCount()).toBe("2");
    expect(container.querySelector<HTMLInputElement>('input[name="steps.1.delayValue"]')?.value).toBe("3");
    const remove = [...container.querySelectorAll("button")].find((button) => button.textContent === "移除第 1 封");
    await act(async () => { remove?.click(); });
    expect(stepCount()).toBe("1");
    expect(container.querySelector('input[name="steps.0.delayValue"]')).not.toBeNull();
    expect(container.querySelector('input[name="steps.1.delayValue"]')).toBeNull();
  });

  it("stops adding at ten e-mails", async () => {
    await act(async () => { root.render(form()); });
    for (let index = 0; index < 12; index += 1) await act(async () => { addStep()?.click(); });
    expect(stepCount()).toBe("10");
    expect(addStep()?.disabled).toBe(true);
  });

  it("keeps the Live of an activated sequence fixed and sends the id and version", async () => {
    await act(async () => {
      root.render(form({
        sequence: { id: "seq-1", version: 7, status: "active", locked: true },
        initialDraft: { name: "序列", liveId: "live-1", steps: [{ id: "step-1", delayValue: "1", delayUnit: "days", messageTemplateId: "template-1", isActive: true }] },
      }));
    });
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="liveId"]')?.value).toBe("live-1");
    expect(container.querySelector('select[name="liveId"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[name="sequenceId"]')?.value).toBe("seq-1");
    expect(container.querySelector<HTMLInputElement>('input[name="expectedVersion"]')?.value).toBe("7");
    expect(container.querySelector<HTMLInputElement>('input[name="steps.0.id"]')?.value).toBe("step-1");
  });

  it("points to the template editor when there is no sequence template yet", async () => {
    await act(async () => { root.render(form({ templates: [] })); });
    expect(container.textContent).toContain("還沒有「追銷序列信」模板");
    expect(container.querySelector('a[href="/messages/templates/new"]')).not.toBeNull();
  });
});
