// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
// The sidebar switcher's action: it re-checks the manager role and that the project is the vendor's own.
vi.mock("@/app/actions/sales-workspace-actions", () => ({ selectSalesProjectAction: mocks.select }));

import { SalesProjectRequiredNotice } from "./sales-project-required-notice";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.select.mockReset();
  mocks.refresh.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(ui: ReactNode) {
  await act(async () => { root.render(ui); });
}

const buttons = () => [...container.querySelectorAll("button")];

describe("SalesProjectRequiredNotice", () => {
  it("lists the vendor's projects and switches through the existing project action, staying on the page", async () => {
    mocks.select.mockResolvedValue(undefined);
    await render(<SalesProjectRequiredNotice projects={[{ id: "p1", name: "秋季課程" }, { id: "p2", name: "冬季講座" }]} />);
    expect(container.querySelector("h2")?.textContent).toBe("一頁式網站屬於銷售專案，請先選擇專案");
    expect(container.textContent).toContain("全部專案總覽（唯讀）");
    expect(buttons().map((button) => button.textContent)).toEqual(["切換到「秋季課程」", "切換到「冬季講座」"]);
    expect(container.querySelector('a[href="/projects"]')).not.toBeNull();
    expect(container.querySelector('a[href="/projects/new"]')).toBeNull();

    await act(async () => { buttons()[1]!.click(); });
    expect(mocks.select).toHaveBeenCalledWith("p2");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("offers to create a sales project when there is none", async () => {
    await render(<SalesProjectRequiredNotice projects={[]} purpose="template" />);
    expect(container.textContent).toContain("你還沒有任何銷售專案");
    expect(container.textContent).toContain("使用範本建立或套用網站");
    const create = container.querySelector('a[href="/projects/new"]');
    expect(create?.textContent).toBe("建立銷售專案");
    expect(buttons()).toHaveLength(0);
  });

  it("reports a refused switch without leaving the page", async () => {
    mocks.select.mockRejectedValue(new Error("project_not_found"));
    await render(<SalesProjectRequiredNotice projects={[{ id: "p1", name: "秋季課程" }]} />);
    await act(async () => { buttons()[0]!.click(); });
    expect(container.querySelector("[role=alert]")?.textContent).toContain("無法切換到這個專案");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(buttons()[0]!.disabled).toBe(false);
  });
});
