import { describe, expect, it, vi } from "vitest";
import { isLiveSlugRace, isLiveSlugTaken, isUniqueConstraintError, liveSlugFromTitle, liveSlugTakenPath, randomLiveSlugSuffix, resolveLiveSlugConflict } from "./live-slug";
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

describe("liveSlugTakenPath", () => {
  it("goes back to the edit page for an existing live and keeps the draft for a new one", () => {
    expect(liveSlugTakenPath("live 1", "")).toBe("/lives/live%201/edit?error=slug_taken");
    expect(liveSlugTakenPath(null, "&draft=draft-1")).toBe("/lives/new?error=slug_taken&draft=draft-1");
  });
});

describe("resolveLiveSlugConflict", () => {
  const input = { vendorId: "vendor-1", slug: "my-live", existingLive: null, draftClaim: { draftId: "draft-1", revision: 3 } };
  const dbWith = (slugOwner: { id: string } | null, draft: { id: string } | null) => ({
    live: { findFirst: vi.fn().mockResolvedValue(slugOwner) },
    liveStudioDraft: { findFirst: vi.fn().mockResolvedValue(draft) },
  });

  it("returns null without looking at the draft when the address is free", async () => {
    const db = dbWith(null, { id: "draft-1" });
    await expect(resolveLiveSlugConflict(db, input)).resolves.toBeNull();
    expect(db.liveStudioDraft.findFirst).not.toHaveBeenCalled();
  });

  it("reports slug_taken only when the draft is still claimable for this vendor and revision", async () => {
    const db = dbWith({ id: "other" }, { id: "draft-1" });
    await expect(resolveLiveSlugConflict(db, input)).resolves.toBe("slug_taken");
    expect(db.liveStudioDraft.findFirst).toHaveBeenCalledWith({
      where: { id: "draft-1", vendorId: "vendor-1", revision: 3, consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      select: { id: true },
    });
  });

  it("reports draft_conflict first when the draft was already consumed or is stale", async () => {
    await expect(resolveLiveSlugConflict(dbWith({ id: "other" }, null), input)).resolves.toBe("draft_conflict");
  });
});

describe("isLiveSlugRace", () => {
  it("is true only for a unique-constraint error where the address is really taken", async () => {
    const taken = { live: { findFirst: vi.fn().mockResolvedValue({ id: "winner" }) } };
    await expect(isLiveSlugRace(taken, { code: "P2002" }, "s", null)).resolves.toBe(true);
    await expect(isLiveSlugRace(taken, new Error("boom"), "s", null)).resolves.toBe(false);
    const free = { live: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(isLiveSlugRace(free, { code: "P2002" }, "s", null)).resolves.toBe(false);
  });
});
