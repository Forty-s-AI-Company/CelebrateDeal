/** 只輸出固定分類；不傳出回應本文、網址、Cookie 或原始錯誤文字。 */
export function publicLiveTransportFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/ECONNRESET|socket hang up/u.test(message)) return "CONNECTION_RESET";
  if (/ECONNREFUSED/u.test(message)) return "CONNECTION_REFUSED";
  if (/ENOTFOUND|EAI_AGAIN/u.test(message)) return "DNS";
  if (/disposed|Target page, context or browser has been closed/u.test(message)) return "CONTEXT_CLOSED";
  if (/ETIMEDOUT|Timeout|timed out/u.test(message)) return "TIMEOUT";
  return "UNKNOWN";
}

export function classifyPublicLiveBrowserDiagnostic(value: unknown) {
  if (typeof value !== "string" || value.length > 160) return null;
  const match = /^(?:Error: )?PUBLIC_LIVE:(ADMISSION|NAVIGATION):(HTTP:[1-5][0-9]{2}|NETWORK:(?:CONNECTION_RESET|CONNECTION_REFUSED|DNS|CONTEXT_CLOSED|TIMEOUT|UNKNOWN))$/u.exec(value);
  if (!match) return null;
  return `public_live stage=${match[1].toLowerCase()} cause=${match[2].toLowerCase().replace(":", "_")}`;
}
