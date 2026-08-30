import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: (effect: () => void) => effect(),
  };
});

import { DirectEntryAttributionReset } from "./direct-entry-attribution-reset";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
});

describe("DirectEntryAttributionReset", () => {
  it("resets both attribution domains for direct entry", () => {
    DirectEntryAttributionReset({ isDirectEntry: true });

    expect(fetch).toHaveBeenCalledWith("/api/affiliate-attribution/direct-entry", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CelebrateDeal-Client": "web",
      },
    });
  });

  it("does not clear a referral context that was explicitly established", () => {
    DirectEntryAttributionReset({ isDirectEntry: false });

    expect(fetch).not.toHaveBeenCalled();
  });
});
