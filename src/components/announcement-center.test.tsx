import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnouncementCenter } from "./announcement-center";

describe("AnnouncementCenter", () => {
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
