import { describe, expect, it, vi } from "vitest";
import { readRegistrationAuditPage, readRegistrationProjectionAuditPage } from "./live-metric-registration-audit";
const request = { vendorId: "v", liveId: "l", versionId: "version", startAt: new Date(0), endAt: new Date(100), afterSubmissionId: null, take: 4 };
const settings = { isolation: "repeatable read", readOnly: "on" };
describe("authoritative registration audit", () => {
  it("keeps missing capture visible and classifies gaps without certifying coverage", async () => {
    const row = { submissionId: "a", captureVersionId: "version", registrationId: "reg", formMatches: true, matches: true };
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([settings]).mockResolvedValueOnce([{ sourceRevision: BigInt(1), registrationRevision: BigInt(1) }])
      .mockResolvedValueOnce([{ ...row, captureVersionId: null }, { ...row, submissionId: "b", registrationId: null },
        { ...row, submissionId: "c", matches: false }, { ...row, submissionId: "d", captureVersionId: "old" }, { ...row, submissionId: "e" }]) };
    const result = await readRegistrationAuditPage(db, request);
    expect(result).toMatchObject({ status: "available", coverage: "unknown", hasMore: true, nextSubmissionId: "d",
      rows: [{ outcome: "missing_capture" }, { outcome: "missing_registration" }, { outcome: "identity_mismatch" }, { outcome: "other_version" }] });
  });
  it("reports an old-form source instead of filtering it out", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([settings]).mockResolvedValueOnce([{ sourceRevision: BigInt(1), registrationRevision: BigInt(1) }])
      .mockResolvedValueOnce([{ submissionId: "old-form", captureVersionId: null, registrationId: null, formMatches: false, matches: false }]) };
    expect(await readRegistrationAuditPage(db, request)).toMatchObject({ rows: [{ submissionId: "old-form", outcome: "form_mismatch" }] });
  });
  it("rejects writable or read-committed transactions before reading sources", async () => {
    for (const value of [{ ...settings, readOnly: "off" }, { ...settings, isolation: "read committed" }]) {
      const db = { $queryRaw: vi.fn().mockResolvedValue([value]) };
      await expect(readRegistrationAuditPage(db, request)).rejects.toThrow("read-only repeatable-read");
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    }
  });
  it("does not equate an empty source page with proven collection", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([settings]).mockResolvedValueOnce([{ sourceRevision: BigInt(0), registrationRevision: BigInt(0) }]).mockResolvedValueOnce([]) };
    expect(await readRegistrationAuditPage(db, request)).toMatchObject({ coverage: "unknown", rows: [], hasMore: false });
  });
});

it("reverse audit distinguishes invalid sources from registrations without capture", async () => {
  const base = { registrationId: "a", sourceMatches: true, captureExists: true, captureMatches: true };
  const db = { $queryRaw: vi.fn().mockResolvedValueOnce([settings]).mockResolvedValueOnce([{ sourceRevision: BigInt(1), registrationRevision: BigInt(1) }])
    .mockResolvedValueOnce([{ ...base, sourceMatches: false }, { ...base, registrationId: "b", captureExists: false },
      { ...base, registrationId: "c", captureMatches: false }, { ...base, registrationId: "d" }]) };
  expect(await readRegistrationProjectionAuditPage(db, request)).toMatchObject({ coverage: "unknown", hasMore: false,
    rows: [{ outcome: "invalid_source" }, { outcome: "registration_without_capture" }, { outcome: "capture_mismatch" }, { outcome: "matched" }] });
});
