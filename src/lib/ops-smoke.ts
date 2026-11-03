import { NextResponse } from "next/server";
import { opsSmokeVendorId } from "./ops-smoke-config";

export { opsSmokeVendorId };

type Environment = Readonly<Record<string, string | undefined>>;

function smokeError(status: 403 | 503, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function opsSmokeVendorUnavailable() {
  return smokeError(503, "Smoke vendor is not configured");
}

/**
 * Binds a smoke payload to the server-configured vendor. A caller may omit
 * vendorId or repeat the configured one; any other vendorId is refused before
 * the payload is validated or a provider/database operation runs.
 */
export function bindOpsSmokeVendor(payload: unknown, env: Environment = process.env):
  { ok: true; payload: unknown } | { ok: false; response: Response } {
  const vendorId = opsSmokeVendorId(env);
  if (!vendorId) return { ok: false, response: opsSmokeVendorUnavailable() };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: true, payload };

  const record = payload as Record<string, unknown>;
  if (record.vendorId !== undefined && record.vendorId !== vendorId) {
    return { ok: false, response: smokeError(403, "Vendor is not permitted for smoke operations") };
  }
  return { ok: true, payload: { ...record, vendorId } };
}
