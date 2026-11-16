/**
 * Small formatting helpers shared by every module that renders a merchant
 * e-mail snapshot (email-delivery.ts, delayed-step-runs.ts). Kept free of
 * database imports so either module can use them without an import cycle.
 */

/** Marketing mail always carries an unsubscribe link, even if the template forgot {{unsubscribe_url}}. */
export function ensureEmailUnsubscribeFooter(body: string, unsubscribeUrl: string) {
  const renderedBody = body.trim();
  if (renderedBody.includes(unsubscribeUrl)) return renderedBody;
  return [renderedBody, `退訂：${unsubscribeUrl}`].filter(Boolean).join("\n\n");
}

/** {{live_start_at}}: shown in Asia/Taipei like every other registrant-facing time. */
export function formatLiveStartAt(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(value);
}
