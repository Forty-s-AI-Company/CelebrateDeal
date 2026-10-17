import { describe, expect, it } from "vitest";
import { createMetricVisitorProofService } from "./live-metric-visitor-proof";

// Synthetic test key only; no platform secrets or browser state are read.
const scope = { vendorId: "v", liveId: "live", versionId: "version" };
const service = () => createMetricVisitorProofService(new Uint8Array(32).fill(7));
describe("scoped metric visitor proof", () => {
  it("issues server identities and verifies only within the lifetime", () => {
    const s = service(); const a = s.issue(scope, 100, 200); const b = s.issue(scope, 100, 200);
    expect(a.visitorId).not.toBe(b.visitorId);
    expect(s.verify(a.proof, scope, 100)).toBe(a.visitorId);
    expect(s.verify(a.proof, scope, 199)).toBe(a.visitorId);
    expect(s.verify(a.proof, scope, 99)).toBeNull();
    expect(s.verify(a.proof, scope, 200)).toBeNull();
  });
  it.each(["vendorId", "liveId", "versionId"])("rejects a different %s", field => {
    const s = service(); const a = s.issue(scope, 100, 200);
    expect(s.verify(a.proof, { ...scope, [field]: "other" }, 150)).toBeNull();
  });
  it("rejects tampering and another key", () => {
    const s = service(); const { proof } = s.issue(scope, 100, 200);
    const [body, signature] = proof.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.visitorId = "10000000-0000-4000-8000-000000000001";
    expect(s.verify(`${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`, scope, 150)).toBeNull();
    expect(createMetricVisitorProofService(new Uint8Array(32).fill(8)).verify(proof, scope, 150)).toBeNull();
  });
  it.each([null, {}, "", "a.b.c", "a.=", "x".repeat(2049)])("rejects malformed input %#", value => {
    expect(service().verify(value, scope, 150)).toBeNull();
  });
  it("rejects invalid issuance and invalid verification clocks", () => {
    expect(() => createMetricVisitorProofService(new Uint8Array(31))).toThrow();
    const s = service();
    expect(() => s.issue(scope, 100, 100)).toThrow();
    expect(() => s.issue(scope, -1, 200)).toThrow();
    const { proof } = s.issue(scope, 100, 200);
    expect(s.verify(proof, scope, NaN)).toBeNull();
    expect(s.verify(proof, scope, 150.5)).toBeNull();
  });
  it("owns the injected key bytes", () => {
    const key = new Uint8Array(32).fill(7); const s = createMetricVisitorProofService(key);
    const { proof, visitorId } = s.issue(scope, 100, 200); key.fill(8);
    expect(s.verify(proof, scope, 150)).toBe(visitorId);
  });
});

it("classifies authentic expiry only after signature and scope validation", () => {
  const s = service(); const { proof } = s.issue(scope, 100, 200);
  expect(s.inspect(proof, scope, 200)).toMatchObject({ status: "expired" });
  expect(s.inspect(proof, scope, 99)).toEqual({ status: "not_yet_valid" });
  expect(s.inspect(proof, { ...scope, vendorId: "other" }, 200)).toEqual({ status: "invalid" });
  expect(s.inspect(proof + "x", scope, 200)).toEqual({ status: "invalid" });
  expect(createMetricVisitorProofService(new Uint8Array(32).fill(8)).inspect(proof, scope, 200)).toEqual({ status: "invalid" });
});

it("verifies retained keys but signs only with the current key", () => {
  const old = { id: "old", key: new Uint8Array(32).fill(1) };
  const current = { id: "current", key: new Uint8Array(32).fill(2) };
  const oldService = createMetricVisitorProofService({ current: old });
  const original = oldService.issue(scope, 100, 200);
  const rotated = createMetricVisitorProofService({ current, previous: [old] });
  expect(rotated.inspect(original.proof, scope, 150)).toMatchObject({ status: "valid", visitorId: original.visitorId, keyId: "old" });
  const fresh = rotated.issue(scope, 100, 200);
  expect(rotated.inspect(fresh.proof, scope, 150)).toMatchObject({ status: "valid", keyId: "current" });
  expect(oldService.inspect(fresh.proof, scope, 150)).toEqual({ status: "unknown_key" });
  expect(createMetricVisitorProofService({ current }).inspect(original.proof, scope, 150)).toEqual({ status: "unknown_key" });
  const [body, signature] = original.proof.split(".");
  const value = JSON.parse(Buffer.from(body, "base64url").toString()); value.keyId = "current";
  expect(rotated.inspect(`${Buffer.from(JSON.stringify(value)).toString("base64url")}.${signature}`, scope, 150)).toEqual({ status: "invalid" });
});
it("rejects duplicate key identifiers and unbounded keyrings", () => {
  const k = { id: "a", key: new Uint8Array(32).fill(1) };
  expect(() => createMetricVisitorProofService({ current: k, previous: [k] })).toThrow();
  expect(() => createMetricVisitorProofService({ current: k, previous: ["b", "c", "d"].map(id => ({ ...k, id })) })).toThrow();
});

it("recovers only authentic expired identities and signs with the current key", () => {
  const old = { id: "old", key: new Uint8Array(32).fill(1) };
  const current = { id: "new", key: new Uint8Array(32).fill(2) };
  const original = createMetricVisitorProofService({ current: old }).issue(scope, 100, 200);
  const s = createMetricVisitorProofService({ current, previous: [old] });
  const recovered = s.recover(original.proof, scope, 200, 300)!;
  expect(recovered.visitorId).toBe(original.visitorId);
  expect(s.inspect(recovered.proof, scope, 200)).toMatchObject({ status: "valid", keyId: "new", expiresAtMs: 300 });
  expect(s.recover(original.proof, scope, 199, 300)).toBeNull();
  expect(s.recover(original.proof, scope, 99, 300)).toBeNull();
  expect(s.recover(original.proof, { ...scope, vendorId: "other" }, 200, 300)).toBeNull();
  expect(s.recover(original.proof + "x", scope, 200, 300)).toBeNull();
  expect(createMetricVisitorProofService({ current }).recover(original.proof, scope, 200, 300)).toBeNull();
  expect(() => s.recover(original.proof, scope, 200, 200)).toThrow();
});

it("extracts version only from authenticated same-live proofs", () => {
  const s = service(); const { proof } = s.issue(scope, 100, 200);
  const live = { vendorId: scope.vendorId, liveId: scope.liveId };
  expect(s.versionForLive(proof, live, 150)).toBe(scope.versionId);
  expect(s.versionForLive(proof, live, 200)).toBe(scope.versionId);
  expect(s.versionForLive(proof, live, 99)).toBeNull();
  expect(s.versionForLive(proof + "x", live, 200)).toBeNull();
  expect(s.versionForLive(proof, { ...live, vendorId: "other" }, 200)).toBeNull();
});
