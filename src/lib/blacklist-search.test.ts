import { describe, expect, it } from "vitest";
import { filterBlacklistEntries } from "@/lib/blacklist-search";

const entries = [
  { id: "1", identifier: "blocked@example.test", reason: "風險名單", notes: null },
  { id: "2", identifier: "visitor-2", reason: "垃圾訊息", notes: "人工確認" },
];

describe("blacklist local search", () => {
  it("matches identifiers, reasons and notes without constructing a URL query", () => {
    expect(filterBlacklistEntries(entries, "EXAMPLE")).toEqual([entries[0]]);
    expect(filterBlacklistEntries(entries, "垃圾")).toEqual([entries[1]]);
    expect(filterBlacklistEntries(entries, "人工")).toEqual([entries[1]]);
  });

  it("returns every entry for an empty query", () => {
    expect(filterBlacklistEntries(entries, "   ")).toEqual(entries);
  });
});
