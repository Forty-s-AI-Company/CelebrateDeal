// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Field, focusFirstInvalidField, FormErrorSummary, useFieldMessages } from "./ui";

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

function CustomControl({ error, hint }: { error?: string; hint?: string }) {
  const field = useFieldMessages(error, hint);
  return (
    <div>
      <label htmlFor="custom">自訂欄位</label>
      <input id="custom" name="custom" {...field.controlProps} className={field.controlClass} />
      {field.messages}
    </div>
  );
}

describe("FormErrorSummary", () => {
  it("renders nothing without a message", () => {
    expect(renderToStaticMarkup(<FormErrorSummary message={null} errors={{ name: "必填" }} />)).toBe("");
  });

  it("announces the message and lists only the non-empty field messages", () => {
    const html = renderToStaticMarkup(<FormErrorSummary message="請修正下列欄位。" errors={{ name: "請填寫名稱。", slug: undefined, price: null, inventory: "" }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("請修正下列欄位。");
    expect(html.match(/<li>/g)).toHaveLength(1);
    expect(html).toContain("<li>請填寫名稱。</li>");
  });

  it("omits the list when there are no field messages", () => {
    expect(renderToStaticMarkup(<FormErrorSummary message="伺服器忙碌，請稍後再試。" />)).not.toContain("<ul");
  });
});

describe("useFieldMessages for hand-written controls", () => {
  it("wires aria-invalid and aria-describedby to the rendered messages", async () => {
    await act(async () => { root.render(<CustomControl error="格式不正確" hint="例如 https://" />); });
    const input = container.querySelector("input")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const ids = input.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(["格式不正確", "例如 https://"]);
    expect(input.className).toContain("border-red-600");
  });

  it("leaves a valid control without invalid state", async () => {
    await act(async () => { root.render(<CustomControl />); });
    const input = container.querySelector("input")!;
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});

describe("focusFirstInvalidField", () => {
  it("focuses the first invalid control in DOM order", async () => {
    await act(async () => {
      root.render(
        <form>
          <FormErrorSummary message="請修正下列欄位。" errors={{ a: "A 錯誤", b: "B 錯誤" }} />
          <Field label="A" name="a" />
          <Field label="B" name="b" error="B 錯誤" />
          <Field label="C" name="c" error="C 錯誤" />
        </form>,
      );
    });
    const target = focusFirstInvalidField(container.querySelector("form"));
    expect(target).toBe(container.querySelector('[name="b"]'));
    expect(document.activeElement).toBe(target);
  });

  it("falls back to the summary when no field is invalid, and does nothing without either", async () => {
    await act(async () => { root.render(<form><FormErrorSummary message="伺服器忙碌，請稍後再試。" /><Field label="A" name="a" /></form>); });
    expect(focusFirstInvalidField(container.querySelector("form"))).toBe(container.querySelector('[role="alert"]'));
    expect(document.activeElement).toBe(container.querySelector('[role="alert"]'));

    await act(async () => { root.render(<form><Field label="A" name="a" /></form>); });
    expect(focusFirstInvalidField(container.querySelector("form"))).toBeNull();
    expect(focusFirstInvalidField(null)).toBeNull();
  });
});

describe("FormErrorSummary field links", () => {
  it("renders each field message as an anchor and routes clicks to onFieldSelect", async () => {
    const selected: string[] = [];
    await act(async () => {
      root.render(
        <FormErrorSummary
          message="請修正下列欄位。"
          errors={{ name: "請填寫名稱。", price: "請填寫售價。", slug: "網址已被使用。" }}
          fieldHref={(name) => (name === "slug" ? undefined : `#section-${name}`)}
          onFieldSelect={(name) => selected.push(name)}
        />,
      );
    });
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#section-name", "#section-price"]);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelectorAll("li")[2]!.textContent).toBe("網址已被使用。");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => { links[1]!.dispatchEvent(event); });
    expect(selected).toEqual(["price"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the plain list untouched without fieldHref", () => {
    expect(renderToStaticMarkup(<FormErrorSummary message="x" errors={{ name: "必填" }} />)).toContain("<li>必填</li>");
  });
});
