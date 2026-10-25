/** Client-safe Turnstile constants (the widget imports these; server logic lives in turnstile.ts). */
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** Form field the widget fills. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

export const TURNSTILE_ACTIONS = {
  register: "merchant_register",
  resendVerification: "merchant_verify_email_resend",
} as const;
export type TurnstileAction = (typeof TURNSTILE_ACTIONS)[keyof typeof TURNSTILE_ACTIONS];
