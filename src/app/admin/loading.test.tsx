import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceLoadingSkeleton } from "@/components/workspace-loading-skeleton";
import AdminLoading from "./loading";

describe("admin loading state", () => {
  it("renders a card and list skeleton instead of the bare root fallback", () => {
    const html = renderToStaticMarkup(<AdminLoading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在載入平台管理");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("fixed inset-0");
    expect((html.match(/animate-pulse/g) ?? []).length).toBeGreaterThan(8);
  });

  it("disables every pulse animation for reduced motion and hides decorative blocks", () => {
    const html = renderToStaticMarkup(
      <WorkspaceLoadingSkeleton id="x" title="t" description="d" statusMessage="s" />,
    );
    const pulses = html.match(/animate-pulse/g) ?? [];
    const reduced = html.match(/motion-reduce:animate-none/g) ?? [];
    expect(reduced.length).toBe(pulses.length);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-labelledby="x-title"');
  });
});
