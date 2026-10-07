import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { saveTrackingCredentialConfiguration, TrackingConfigurationConflict } from "@/lib/tracking-settings";
import { unprotectFacebookAccessToken } from "@/lib/tracking-credentials";
const db = getDb();
// The standard CI unit suite also runs this file. Always use a synthetic,
// sufficiently long key rather than depending on the runner's injected key.
beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-tracking-encryption-key-at-least-32-bytes"));
afterEach(() => vi.unstubAllEnvs());
const token = "synthetic-meta-token-for-isolated-database-tests";
const input = { expectedRevision: 0, token, testEventCode: "SYNTHETIC_TEST", clearToken: false };
async function vendor() {
  const suffix = randomUUID();
  return db.vendor.create({ data: { name: "Synthetic tracking shop", slug: `tracking-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
}
// All rows belong to this disposable database; the runner destroys it after tests.
it("stores tenant-bound ciphertext and preserves it when the password field is blank", async () => {
  const v = await vendor();
  await saveTrackingCredentialConfiguration(v.id, input);
  let row = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: v.id } });
  expect(row.facebookAccessTokenEncrypted).not.toContain(token);
  expect(unprotectFacebookAccessToken(v.id, row.facebookAccessTokenEncrypted!)).toBe(token);
  const original = row.facebookAccessTokenEncrypted;
  await saveTrackingCredentialConfiguration(v.id, { ...input, token: "", expectedRevision: 1 });
  row = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: v.id } });
  expect(row.facebookAccessTokenEncrypted).toBe(original); expect(row.credentialRevision).toBe(2);
});
it("rejects stale saves without changing token, test code or revision", async () => {
  const v = await vendor(); await saveTrackingCredentialConfiguration(v.id, input);
  const before = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: v.id } });
  await expect(saveTrackingCredentialConfiguration(v.id, { ...input, testEventCode: "STALE" })).rejects.toBeInstanceOf(TrackingConfigurationConflict);
  expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: v.id } })).toEqual(before);
});
it("permits exactly one concurrent revision-zero save", async () => {
  const v = await vendor();
  const results = await Promise.allSettled([saveTrackingCredentialConfiguration(v.id, input), saveTrackingCredentialConfiguration(v.id, input)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect(await db.trackingSetting.count({ where: { vendorId: v.id } })).toBe(1);
  expect((await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: v.id } })).credentialRevision).toBe(1);
});
it("isolates tenants and cannot decrypt another shop's credential", async () => {
  const a = await vendor(); const b = await vendor();
  await saveTrackingCredentialConfiguration(a.id, input);
  await saveTrackingCredentialConfiguration(b.id, { ...input, token: "synthetic-other-tenant-token-for-tests" });
  const before = await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: b.id } });
  await saveTrackingCredentialConfiguration(a.id, { ...input, expectedRevision: 1, clearToken: true, token: "" });
  expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: b.id } })).toEqual(before);
  expect(() => unprotectFacebookAccessToken(a.id, before.facebookAccessTokenEncrypted!)).toThrow("Tracking credential unavailable.");
});
it("requires an unambiguous valid operation before writing", async () => {
  const v = await vendor();
  await expect(saveTrackingCredentialConfiguration(v.id, { ...input, clearToken: true })).rejects.toThrow("Choose one credential operation.");
  await expect(saveTrackingCredentialConfiguration(v.id, { ...input, token: "short" })).rejects.toThrow("Invalid tracking credential.");
  expect(await db.trackingSetting.count({ where: { vendorId: v.id } })).toBe(0);
  await saveTrackingCredentialConfiguration(v.id, input);
  await saveTrackingCredentialConfiguration(v.id, { ...input, expectedRevision: 1, clearToken: true, token: "", testEventCode: null });
  expect(await db.trackingSetting.findUniqueOrThrow({ where: { vendorId: v.id } })).toMatchObject({ facebookAccessTokenEncrypted: null, facebookTestEventCode: null, credentialRevision: 2 });
});
