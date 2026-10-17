import { describe, expect, it } from "vitest";
import { calculateCompletionProjection, type CompletionProjectionInput } from "./live-core-metrics-read-model";
const scope = { vendorId: "v", liveId: "l", contentVersionId: "version", mode: "replay" } as const;
const viewing = { scope, personId: "p", wallStartMs: 100, wallEndMs: 1100, mediaStartMs: 0, mediaEndMs: 1000 };
const input = (): CompletionProjectionInput => ({ scope, startMs: 0, endMs: 2000, durationMs: 1000,
  registrations: [{ scope, personId: "p", browserId: null, verifiedAtMs: 100 }], viewing: [viewing] });
describe("completion projection candidates", () => {
  it("returns exact first crossing despite duplicate and delayed device segments", () => {
    const value = { ...input(), viewing: [{ ...viewing, wallStartMs: 2000, wallEndMs: 3000 }, viewing, viewing] };
    expect(calculateCompletionProjection(value)).toEqual({ status: "available", cohortCount: 1,
      rows: [{ scope, personId: "p", firstCompletedAtMs: 1000 }] });
  });
  it("distinguishes complete empty history from missing history", () => {
    expect(calculateCompletionProjection({ ...input(), viewing: [] })).toEqual({ status: "available", cohortCount: 1, rows: [] });
    expect(calculateCompletionProjection({ ...input(), viewing: null })).toEqual({ status: "unavailable", reason: "missing_data" });
  });
  it("rejects cross-tenant facts and conflicting verification identities", () => {
    expect(calculateCompletionProjection({ ...input(), viewing: [{ ...viewing, scope: { ...scope, vendorId: "other" } }] })).toEqual({ status: "unavailable", reason: "invalid_data" });
    expect(calculateCompletionProjection({ ...input(), registrations: [...input().registrations!, { scope, personId: "p", browserId: null, verifiedAtMs: 101 }] })).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it("excludes pre-verification coverage and the exclusive window endpoint", () => {
    expect(calculateCompletionProjection({ ...input(), endMs: 1000 })).toEqual({ status: "available", cohortCount: 1, rows: [] });
    expect(calculateCompletionProjection({ ...input(), registrations: [{ scope, personId: "p", browserId: null, verifiedAtMs: 500 }] })).toEqual({ status: "available", cohortCount: 1, rows: [] });
  });
});
