import { describe, expect, it, vi } from "vitest";
import { isLiveSlugTaken, isUniqueConstraintError, liveSlugFromTitle, randomLiveSlugSuffix } from "./live-slug";
import { toSlug } from "./format";

describe("liveSlugFromTitle", () => {
  it("keeps ASCII words from the title and appends the suffix", () => {
    expect(liveSlugFromTitle("週五 New Arrivals 直播!", "k3x9p")).toBe("new-arrivals-k3x9p");
  });

  it("falls back to a generic base for Chinese-only titles", () => {
    expect(liveSlugFromTitle("週五新品導購直播", "k3x9p")).toBe("live-k3x9p");
    expect(liveSlugFromTitle("", "k3x9p")).toBe("live-k3x9p");
  });

  it("produces slugs that survive toSlug unchanged and stay short", () => {
    const slug = liveSlugFromTitle("A".repeat(200), "abcde");
    expect(slug.length).toBeLessThanOrEqual(46);
    expect(toSlug(slug)).toBe(slug);
  });

  it("generates an unambiguous random suffix", () => {
    const suffix = randomLiveSlugSuffix();
    expect(suffix).toMatch(/^[a-z2-9]{5}$/u);
    expect(suffix).not.toMatch(/[01lo]/u);
  });
});

describe("isLiveSlugTaken", () => {
  it("checks the global slug and excludes the live being edited", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "other" });
    await expect(isLiveSlugTaken({ live: { findFirst } }, "my-live", "live-1")).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({ where: { slug: "my-live", id: { not: "live-1" } }, select: { id: true } });
  });

  it("reports a free slug and does not exclude anything on create", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(isLiveSlugTaken({ live: { findFirst } }, "my-live", null)).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({ where: { slug: "my-live" }, select: { id: true } });
  });
});

describe("isUniqueConstraintError", () => {
  it("recognizes Prisma P2002 only", () => {
    expect(isUniqueConstraintError({ code: "P2002" })).toBe(true);
    expect(isUniqueConstraintError({ code: "P2034" })).toBe(false);
    expect(isUniqueConstraintError(new Error("x"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});
