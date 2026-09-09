import { describe, expect, it } from "vitest";
import manifest from "../../public/manifest.json";
import { readFileSync } from "node:fs";

describe("PWA contract", () => {
  it("exposes an installable standalone manifest", () => {
    expect(manifest.name).toContain("CelebrateDeal");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect(manifest.icons.every((icon) => icon.src && icon.sizes)).toBe(true);
  });

  it("contains offline and push service-worker handlers", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain("addEventListener(\"install\"");
    expect(worker).toContain("addEventListener(\"fetch\"");
    expect(worker).toContain("addEventListener(\"push\"");
    expect(worker).toContain("addEventListener(\"notificationclick\"");
    expect(worker).toContain('caches.match("/offline.html")');
    expect(worker).toContain("candidate.origin === self.location.origin");
    expect(worker).toContain("private|no-store");
  });
});
