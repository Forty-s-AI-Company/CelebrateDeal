/**
 * Preview smoke routes may use the server-owned fixture vendor when the caller
 * deliberately omits vendorId. Production never receives this fallback.
 */
export function withPreviewSmokeVendorId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.vendorId === "string" && record.vendorId.trim()) {
    return payload;
  }

  const smokeVendorId = process.env.SMOKE_VENDOR_ID?.trim();
  if (process.env.VERCEL_ENV !== "preview" || !smokeVendorId) {
    return payload;
  }

  return { ...record, vendorId: smokeVendorId };
}
