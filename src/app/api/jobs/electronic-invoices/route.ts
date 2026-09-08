import { NextResponse } from "next/server";
import { requireJobSecret, unauthorizedJson } from "@/lib/api-security";
import { runElectronicInvoiceJob } from "@/lib/taiwan-electronic-invoice-job";
import { captureOperationalError } from "@/lib/monitoring";

export async function POST(request: Request) {
  if (!requireJobSecret(request)) return unauthorizedJson();
  try {
    // No production provider is silently selected. Until a fiscal adapter is
    // explicitly wired, rows remain durable `queued` snapshots.
    const result = await runElectronicInvoiceJob();
    return NextResponse.json({ ok: result.adapterAvailable, ...result }, { status: result.adapterAvailable ? 200 : 202 });
  } catch (error) {
    try {
      captureOperationalError(error, { source: "electronic_invoice_job", operation: "run", status: "failed" });
    } catch {
      // Monitoring failure must not leak or replace the sanitized response.
    }
    return NextResponse.json({ ok: false, error: "electronic_invoice_job_failed" }, { status: 503 });
  }
}
