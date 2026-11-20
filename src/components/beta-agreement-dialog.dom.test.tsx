// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BetaAgreementDialog } from "./beta-agreement-dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// happy-dom has no layout: give the agreement region a measurable box.
const layout = { scrollHeight: 2_000, clientHeight: 400 };
const scrollTops = new WeakMap<Element, number>();
const isRegion = (element: Element) => element.hasAttribute("data-beta-agreement-scroll");
// Own descriptors on HTMLElement.prototype before the test overrides them (usually none).
const originals = Object.fromEntries(["scrollHeight", "clientHeight", "scrollTop"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get(this: HTMLElement) { return isRegion(this) ? layout.scrollHeight : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get(this: HTMLElement) { return isRegion(this) ? layout.clientHeight : 0; } });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) { return scrollTops.get(this) ?? 0; },
    set(this: HTMLElement, value: number) { scrollTops.set(this, value); },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
  layout.scrollHeight = 2_000;
  layout.clientHeight = 400;
});

async function mountAccept(action = vi.fn()) {
  await act(async () => {
    root.render(
      <BetaAgreementDialog
        mode="accept"
        title="CelebrateDeal 封測合作協議"
        intro={<p>使用後台前，請閱讀並同意本協議。<a href="#public-copy">公開版本</a></p>}
        action={action}
        csrfField={<input type="hidden" name="csrfToken" value="synthetic" />}
        vendorId="vendor-1"
        agreementVersion="beta-2026.11.20"
        next="/welcome"
        footer={<button type="button">登出</button>}
      >
        <p>第 1 條</p>
        <p>第 11 條</p>
      </BetaAgreementDialog>,
    );
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const region = () => document.querySelector<HTMLElement>('[data-beta-agreement-scroll]')!;
const checkbox = () => document.querySelector<HTMLInputElement>('input[name="acceptBetaAgreement"]')!;
const submit = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).find((button) => button.textContent?.includes("同意並進入後台"))!;

async function scrollTo(top: number) {
  await act(async () => {
    region().scrollTop = top;
    region().dispatchEvent(new Event("scroll"));
  });
}
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

describe("BetaAgreementDialog", () => {
  it("is a labelled modal dialog that starts on the scrollable agreement", async () => {
    await mountAccept();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)?.textContent).toBe("CelebrateDeal 封測合作協議");
    expect(document.getElementById(dialog().getAttribute("aria-describedby")!)?.textContent).toContain("請閱讀並同意本協議");
    expect(region().getAttribute("role")).toBe("region");
    expect(region().getAttribute("aria-label")).toBe("協議全文");
    expect(region().tabIndex).toBe(0);
    expect(document.activeElement).toBe(region());
  });

  it("keeps the checkbox disabled until the agreement is scrolled to the end, and the button until it is ticked", async () => {
    await mountAccept();
    expect(checkbox().disabled).toBe(true);
    const hint = document.getElementById(checkbox().getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe("請先把協議捲動到最後，才能勾選同意。");
    expect(submit().disabled).toBe(true);

    await scrollTo(800);
    expect(checkbox().disabled).toBe(true);

    await scrollTo(layout.scrollHeight - layout.clientHeight);
    expect(checkbox().disabled).toBe(false);
    expect(checkbox().hasAttribute("aria-describedby")).toBe(false);
    expect(submit().disabled).toBe(true);

    await act(async () => { checkbox().click(); });
    expect(checkbox().checked).toBe(true);
    expect(submit().disabled).toBe(false);
    await act(async () => { checkbox().click(); });
    expect(submit().disabled).toBe(true);
  });

  it("enables the checkbox at once when the whole agreement fits without scrolling", async () => {
    layout.scrollHeight = 300;
    await mountAccept();
    expect(checkbox().disabled).toBe(false);
  });

  it("carries the server-provided vendor, version and return path but no scroll state", async () => {
    await mountAccept();
    const form = checkbox().form!;
    expect(form.querySelector<HTMLInputElement>('input[name="vendorId"]')?.value).toBe("vendor-1");
    expect(form.querySelector<HTMLInputElement>('input[name="agreementVersion"]')?.value).toBe("beta-2026.11.20");
    expect(form.querySelector<HTMLInputElement>('input[name="next"]')?.value).toBe("/welcome");
    expect(form.querySelector('[name*="scroll"]')).toBeNull();
    // 登出 is a separate form; nesting it in the accept form would be invalid HTML.
    expect(form.contains(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "登出")!)).toBe(false);
  });

  it("traps Tab inside the dialog and cannot be dismissed with Escape", async () => {
    await mountAccept();
    await scrollTo(layout.scrollHeight);
    await act(async () => { checkbox().click(); });
    const focusable = Array.from(dialog().querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), [tabindex='0']"));
    // Reading order: the public-copy link, the agreement, the checkbox, 同意, 登出.
    expect(focusable).toEqual([document.querySelector("a")!, region(), checkbox(), submit(), focusable.at(-1)]);
    expect(focusable.at(-1)?.textContent).toBe("登出");

    focusable.at(-1)!.focus();
    await press("Tab");
    expect(document.activeElement).toBe(focusable[0]);
    await press("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(focusable.at(-1));

    await press("Escape");
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[data-beta-agreement-gate="accept"]')).not.toBeNull();
  });

  it("shows only the waiting notice and secondary controls to a member who cannot accept", async () => {
    await act(async () => {
      root.render(
        <BetaAgreementDialog mode="waiting" title="等待商家 owner 同意封測合作協議" intro={<p>owner 尚未同意。</p>} error={null} footer={<button type="button">登出</button>}>
          <p>第 1 條</p>
        </BetaAgreementDialog>,
      );
    });
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(Array.from(document.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["登出"]);
  });

  it("announces a server error", async () => {
    await act(async () => {
      root.render(
        <BetaAgreementDialog mode="waiting" title="t" intro="i" error="協議已更新為新版本，請重新閱讀後再同意。">
          <p>x</p>
        </BetaAgreementDialog>,
      );
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("協議已更新為新版本，請重新閱讀後再同意。");
  });
});
