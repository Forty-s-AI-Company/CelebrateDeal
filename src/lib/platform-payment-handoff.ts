import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { allowedPaymentUrl, checkoutSessionFromMetadata } from "./payment-checkout-presentation";

// This response is emitted only by the authenticated selection POST. A GET
// to the plans page never automatically resends an existing provider form.
const SUBMIT_SCRIPT = 'const form=document.getElementById("payment-handoff");let submitted=false;form.addEventListener("submit",event=>{if(submitted){event.preventDefault();return;}submitted=true;form.querySelector("button").disabled=true;});form.requestSubmit();';
const SCRIPT_HASH = createHash("sha256").update(SUBMIT_SCRIPT).digest("base64");

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function platformPaymentHandoffResponse(metadata: unknown) {
  const session = checkoutSessionFromMetadata({ checkoutSession: metadata });
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
  if (session.mode === "redirect") {
    const destination = allowedPaymentUrl(session.checkoutUrl);
    return destination ? new NextResponse(null, { status: 303, headers: { ...headers, Location: destination } }) : null;
  }
  const action = session.mode === "form_post" ? allowedPaymentUrl(session.formAction) : null;
  if (!action || Object.keys(session.formPayload).length === 0) return null;
  const fields = Object.entries(session.formPayload).map(([name, value]) =>
    `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
  ).join("");
  const body = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>前往付款頁</title><body><p role="status">正在前往付款頁…</p><form id="payment-handoff" method="post" action="${escapeHtml(action)}">${fields}<button type="submit">若未自動跳轉，按此繼續付款</button></form><script>${SUBMIT_SCRIPT}</script></body></html>`;
  return new NextResponse(body, {
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${SCRIPT_HASH}'; form-action ${action}; base-uri 'none'; frame-ancestors 'none'`,
    },
  });
}
