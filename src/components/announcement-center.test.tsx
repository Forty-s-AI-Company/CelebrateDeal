import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: vi.fn<() => string | null>(() => null) }));
vi.mock("next/navigation", () => ({ usePathname: navigation.pathname }));

import { AnnouncementCenter } from "./announcement-center";

afterEach(() => navigation.pathname.mockReset().mockReturnValue(null));

describe("AnnouncementCenter", () => {
  it("hides the launcher on the full-screen editor route only", () => {
    navigation.pathname.mockReturnValue("/landing-pages/page-1/edit");
    expect(renderToStaticMarkup(<AnnouncementCenter />)).toBe("");
    for (const pathname of ["/landing-pages/page-1/operations", "/landing-pages", "/dashboard", "/"]) {
      navigation.pathname.mockReturnValue(pathname);
      expect(renderToStaticMarkup(<AnnouncementCenter />)).toContain('data-testid="announcement-center-launcher"');
    }
  });

  it("renders a hydration-safe launcher without opening a dialog during SSR", () => {
    const html = renderToStaticMarkup(<AnnouncementCenter />);

    expect(html).toContain("最新消息");
    expect(html).toContain('data-testid="announcement-center-launcher"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("localStorage");
  });

  it("keeps the client boundary and required dialog safeguards in the source", async () => {
    const source = await readFile(new URL("./announcement-center.tsx", import.meta.url), "utf8");

    for (const required of [
      '"use client"',
      'role="dialog"',
      'aria-modal="true"',
      "aria-labelledby",
      "aria-describedby",
      "document.body.style.overflow",
      "event.key === \"Escape\"",
      "getFocusableElements",
      "motion-reduce:transition-none",
      "useMemo(() => sortAnnouncements(feed), [feed])",
      "autoOpenEvaluatedVersionsRef",
      "if (hasExistingDialog()) return;",
      "if (!timerFired) evaluatedVersions.delete(latestVersion)",
      "const focusRestoreTimer = focusRestoreTimerRef",
      "focusRestoreTimer.current = window.setTimeout",
      "if (focusTarget?.isConnected) focusTarget.focus()",
    ]) {
      expect(source).toContain(required);
    }
    expect(source).not.toContain("dangerouslySetInnerHTML");
    expect(source.match(/if \(hasExistingDialog\(\)\) return;/g)).toHaveLength(3);
  });
});
