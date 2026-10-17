import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const Scope = z.object({ vendorId: id, liveId: id, versionId: id }).strict();
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const Payload = Scope.extend({ keyId: id, visitorId: z.string().uuid(), issuedAtMs: timestamp, expiresAtMs: timestamp }).strict();
export type MetricVisitorProofResult = { status: "valid" | "expired"; visitorId: string; expiresAtMs: number; keyId: string } | { status: "invalid" | "not_yet_valid" | "unknown_key" };

type VisitorScope = z.infer<typeof Scope>;
const purpose = "celebratedeal:metric-visitor:v1:";

/** Server-only primitive. Inject a dedicated provider-managed key; never use
 * request identities or this proof as admission, consent, or coverage evidence.
 * The caller must persist the generated visitor before returning the proof.
 */
export type MetricVisitorKey = { id: string; key: Uint8Array };
export type MetricVisitorKeyring = { current: MetricVisitorKey; previous?: readonly MetricVisitorKey[] };
export function createMetricVisitorProofService(input: Uint8Array | MetricVisitorKeyring) {
  const ring = input instanceof Uint8Array ? { current: { id: "default", key: input } } : input;
  const entries = [ring.current, ...(ring.previous ?? [])];
  if (entries.length > 3) throw new Error("Metric visitor key unavailable");
  const keys = new Map<string, Buffer>();
  for (const entry of entries) {
    if (!id.safeParse(entry.id).success || !(entry.key instanceof Uint8Array) || entry.key.byteLength < 32 || keys.has(entry.id)) throw new Error("Metric visitor key unavailable");
    // Keep an owned snapshot; caller mutation cannot silently rotate keys.
    keys.set(entry.id, Buffer.from(entry.key));
  }
  const currentKeyId = ring.current.id;
  const sign = (body: string, key: Buffer) => createHmac("sha256", key).update(purpose).update(body).digest();
  function inspect(proof: unknown, expected: VisitorScope, nowMs: number): MetricVisitorProofResult {
      const scope = Scope.safeParse(expected);
      if (!scope.success || !timestamp.safeParse(nowMs).success || typeof proof !== "string" || proof.length > 2048) return { status: "invalid" };
      const parts = proof.split(".");
      if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return { status: "invalid" };
      const [body, signature] = parts;
      const supplied = Buffer.from(signature, "base64url");
      if (supplied.length !== 32 || supplied.toString("base64url") !== signature) return { status: "invalid" };
      try {
        const bytes = Buffer.from(body, "base64url");
        if (bytes.toString("base64url") !== body) return { status: "invalid" };
        const parsed = Payload.safeParse(JSON.parse(bytes.toString("utf8")));
        if (!parsed.success) return { status: "invalid" };
        const value = parsed.data;
        const key = keys.get(value.keyId);
        // This reason is untrusted metadata, never evidence of authenticity.
        if (!key) return { status: "unknown_key" };
        if (!timingSafeEqual(supplied, sign(body, key))) return { status: "invalid" };
        if (value.expiresAtMs <= value.issuedAtMs) return { status: "invalid" };
        if (value.vendorId !== scope.data.vendorId || value.liveId !== scope.data.liveId || value.versionId !== scope.data.versionId) return { status: "invalid" };
        if (value.issuedAtMs > nowMs) return { status: "not_yet_valid" };
        return { status: value.expiresAtMs <= nowMs ? "expired" : "valid", visitorId: value.visitorId, expiresAtMs: value.expiresAtMs, keyId: value.keyId };
      } catch {
        return { status: "invalid" };
      }
    }
  function issueIdentity(scope: VisitorScope, visitorId: string, nowMs: number, expiresAtMs: number) {
    const payload = Payload.parse({ ...Scope.parse(scope), keyId: currentKeyId, visitorId, issuedAtMs: nowMs, expiresAtMs });
    if (expiresAtMs <= nowMs) throw new Error("Metric visitor lifetime unavailable");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return { visitorId: payload.visitorId, proof: `${body}.${sign(body, keys.get(currentKeyId)!).toString("base64url")}` };
  }
  return {
    issue(scope: VisitorScope, nowMs: number, expiresAtMs: number) {
      return issueIdentity(scope, randomUUID(), nowMs, expiresAtMs);
    },
    // Internal recovery only: caller must check current collection, expiry and
    // persisted identity. This never accepts a caller-chosen visitor ID.
    recover(proof: unknown, scope: VisitorScope, nowMs: number, expiresAtMs: number) {
      const checked = inspect(proof, scope, nowMs);
      if (checked.status !== "expired") return null;
      return issueIdentity(scope, checked.visitorId, nowMs, expiresAtMs);
    },
    // Read an old version only after verifying its full signed scope. Never
    // use unverified payload fields to decide whether to replace an identity.
    versionForLive(proof: unknown, expected: { vendorId: string; liveId: string }, nowMs: number): string | null {
      if (typeof proof !== "string" || proof.length > 2048) return null;
      try {
        const payload = Payload.safeParse(JSON.parse(Buffer.from(proof.split(".")[0], "base64url").toString("utf8")));
        if (!payload.success) return null;
        const versionId = payload.data.versionId;
        const result = inspect(proof, { ...expected, versionId }, nowMs);
        return result.status === "valid" || result.status === "expired" ? versionId : null;
      } catch { return null; }
    },
    inspect,
    verify(proof: unknown, expected: VisitorScope, nowMs: number): string | null {
      const result = inspect(proof, expected, nowMs);
      return result.status === "valid" ? result.visitorId : null;
    },
  };
}
