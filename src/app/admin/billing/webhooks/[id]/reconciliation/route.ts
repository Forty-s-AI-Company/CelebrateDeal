import { NextResponse } from "next/server";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reconcileWebhookEvent } from "@/lib/reconciliation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireFinanceAdmin();
  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const event = await getDb().webhookEvent.findUnique({
    where: { id },
    select: { id: true, provider: true, eventId: true, status: true, payload: true },
  });
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Export only normalized reconciliation checks. Raw/normalized provider
  // payloads stay inside the redacted admin detail page and are never copied
  // into this downloadable artifact.
  const checks = await reconcileWebhookEvent(event as Parameters<typeof reconcileWebhookEvent>[0]);
  const summary = {
    pass: checks.filter((check) => check.status === "pass").length,
    warning: checks.filter((check) => check.status === "warning").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };

  return NextResponse.json(
    {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      event: {
        id: event.id,
        provider: event.provider,
        eventId: event.eventId,
        status: event.status,
      },
      summary,
      checks,
    },
    {
      headers: {
        "cache-control": "no-store",
        "content-disposition": "attachment; filename=webhook-reconciliation.json",
      },
    },
  );
}
