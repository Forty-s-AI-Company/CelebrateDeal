import type { Wp4PayUniPurpose } from "@/lib/wp4-payuni-sandbox-reconciliation";

const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const PURPOSES: readonly Wp4PayUniPurpose[] = [
  "buyer_order",
  "platform_subscription",
  "invoice_payment",
];

/**
 * Generates the only checkout idempotency namespace allowed for a current WP4
 * Sandbox run. The source commit and purpose are both server-owned inputs;
 * callers must not be able to choose either value through HTTP.
 */
export function wp4PayUniSandboxCheckoutIdempotencyKey(
  sourceCommit: string,
  purpose: Wp4PayUniPurpose,
): string | null {
  if (!SOURCE_SHA.test(sourceCommit) || !PURPOSES.includes(purpose)) return null;
  return `wp4-payuni-sandbox:v1:${sourceCommit}:${purpose}`;
}

/**
 * Adds the current deployment marker without preserving unknown caller metadata.
 * Checkout builders pass only their own fixed purpose identity into this helper.
 */
export function wp4PayUniSandboxMetadata(
  sourceCommit: string,
  purpose: Wp4PayUniPurpose,
  fixtureIdentity: Readonly<Record<string, string>>,
): Record<string, string> | null {
  if (!SOURCE_SHA.test(sourceCommit) || !PURPOSES.includes(purpose)) return null;
  if (Object.entries(fixtureIdentity).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9]*$/u.test(key) || typeof value !== "string" || value.length === 0 || value.length > 128)) return null;
  return { billingPurpose: purpose, ...fixtureIdentity, wp4SourceCommit: sourceCommit };
}
