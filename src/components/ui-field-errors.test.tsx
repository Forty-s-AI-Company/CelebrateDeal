import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Field, SelectField, TextArea } from "@/components/ui";

describe("shared form controls expose error and hint slots (F-117)", () => {
  it("marks an invalid Field and links its message through aria-describedby", () => {
    const html = renderToStaticMarkup(<Field label="商品名稱" name="name" error="請填寫商品名稱。" hint="最多 200 字" />);
    expect(html).toContain('aria-invalid="true"');
    const describedBy = /aria-describedby="([^"]+)"/u.exec(html)?.[1] ?? "";
    for (const id of describedBy.split(" ")) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("請填寫商品名稱。");
    expect(html).toContain("最多 200 字");
  });

  it("renders no invalid state or description when there is neither error nor hint", () => {
    const html = renderToStaticMarkup(<Field label="商品名稱" name="name" />);
    expect(html).not.toContain("aria-invalid");
    expect(html).not.toContain("aria-describedby");
  });

  it("supports TextArea and SelectField", () => {
    const area = renderToStaticMarkup(<TextArea label="描述" name="description" error="太長" />);
    const select = renderToStaticMarkup(<SelectField label="類型" name="type" error="請選擇"><option value="">-</option></SelectField>);
    for (const html of [area, select]) {
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain("aria-describedby=");
    }
  });

  it("keeps the same outer element with and without messages so toggling an error never remounts the control", () => {
    const outer = (html: string) => /^<(\w+)/u.exec(html)?.[1];
    expect(outer(renderToStaticMarkup(<Field label="a" name="a" />)))
      .toBe(outer(renderToStaticMarkup(<Field label="a" name="a" error="x" />)));
  });

  it("keeps error text out of the label so the accessible name stays the label", () => {
    const html = renderToStaticMarkup(<Field label="商品名稱" name="name" error="請填寫商品名稱。" />);
    expect(/<label[^>]*>(.*?)<\/label>/u.exec(html)?.[1]).not.toContain("請填寫商品名稱。");
  });
});
