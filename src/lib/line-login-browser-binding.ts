import { createHash, timingSafeEqual } from "node:crypto";
import { getCanonicalAppUrl } from "./app-url";

export const LINE_LOGIN_BROWSER_COOKIE = "celebrate_line_oauth";
export function lineLoginBrowserBinding(state:string) {
  return createHash("sha256").update(state).digest("hex");
}
export function matchesLineLoginBrowser(state:string,binding:string|undefined) {
  return typeof binding === "string" && /^[a-f0-9]{64}$/u.test(binding) && timingSafeEqual(Buffer.from(binding),Buffer.from(lineLoginBrowserBinding(state)));
}
export function lineLoginBrowserCookieOptions() {
  return {httpOnly:true,sameSite:"lax" as const,secure:new URL(getCanonicalAppUrl()).protocol==="https:",path:"/api/auth/line",maxAge:600};
}
