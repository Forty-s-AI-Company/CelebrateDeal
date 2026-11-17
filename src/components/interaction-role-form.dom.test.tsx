// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InteractionRole } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ upsertInteractionRoleAction: vi.fn() }));

import { InteractionRoleForm } from "./interaction-role-form";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const role = { id: "role-1", vendorId: "vendor-1", name: "客服小幫手", avatarUrl: "https://cdn.example.test/a.svg", label: "客服助手", roleType: "support", tone: "溫和、清楚", isActive: true, isSimulated: true, isScheduled: true, createdAt: new Date(0), updatedAt: new Date(0) } as InteractionRole;

async function render(value?: InteractionRole) {
  await act(async () => root.render(<InteractionRoleForm role={value} csrfToken="csrf-test" />));
}

describe("InteractionRoleForm 欄位元件遷移", () => {
  it("暱稱、角色類型、語氣設定由 label 關聯，且保留原有屬性", async () => {
    await render(role);
    const byLabel = (text: string) => {
      const label = Array.from(container.querySelectorAll("label")).find((item) => item.textContent?.startsWith(text));
      return label?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea");
    };
    const name = byLabel("暱稱") as HTMLInputElement;
    expect(name.name).toBe("name");
    expect(name.required).toBe(true);
    expect(name.placeholder).toBe("例如：官方商品顧問");
    expect(name.value).toBe("客服小幫手");
    expect((byLabel("角色類型") as HTMLSelectElement).name).toBe("roleType");
    expect((byLabel("語氣設定") as HTMLTextAreaElement).name).toBe("tone");
  });

  it("送出內容維持不變，角色類型為受控並可切換", async () => {
    await render(role);
    const form = container.querySelector("form")!;
    const data = Object.fromEntries(new FormData(form).entries());
    expect(data).toMatchObject({ name: "客服小幫手", roleType: "support", tone: "溫和、清楚", label: "客服助手" });
    const select = container.querySelector<HTMLSelectElement>('select[name="roleType"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "ai_host");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(new FormData(form).get("roleType")).toBe("ai_host");
  });

  it("新增模式預設官方角色與預設語氣", async () => {
    await render(undefined);
    const data = new FormData(container.querySelector("form")!);
    expect(data.get("roleType")).toBe("official");
    expect(data.get("name")).toBe("");
    expect(String(data.get("tone"))).toContain("溫和、清楚");
  });
});
