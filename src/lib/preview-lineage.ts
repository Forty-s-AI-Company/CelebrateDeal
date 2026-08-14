const BASE_SOURCE_DIGEST = "sha256:cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34";

export const LINEAGE_PAYLOAD = Object.freeze({
  schemaVersion: "celebratedeal-preview-lineage/v2",
  baseWorkPackage: "WP-187",
  baseSourceDigest: BASE_SOURCE_DIGEST,
  remediationWorkPackage: "FIN-08U",
  sourceDigestSemantics: "wp187_base_lineage",
});

type LineagePayload = typeof LINEAGE_PAYLOAD;

const LINEAGE_KEYS = Object.keys(LINEAGE_PAYLOAD).sort();
const SAFE_DIGEST = /^sha256:[0-9a-f]{64}$/u;

export function validatePreviewLineagePayload(value: unknown): value is LineagePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("\u0000") !== LINEAGE_KEYS.join("\u0000")) return false;
  return record.schemaVersion === LINEAGE_PAYLOAD.schemaVersion
    && record.baseWorkPackage === LINEAGE_PAYLOAD.baseWorkPackage
    && typeof record.baseSourceDigest === "string"
    && SAFE_DIGEST.test(record.baseSourceDigest)
    && record.baseSourceDigest === LINEAGE_PAYLOAD.baseSourceDigest
    && record.remediationWorkPackage === LINEAGE_PAYLOAD.remediationWorkPackage
    && record.sourceDigestSemantics === LINEAGE_PAYLOAD.sourceDigestSemantics;
}
