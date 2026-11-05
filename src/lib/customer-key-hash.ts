import { createHmac } from "node:crypto";
import { deriveSensitiveDataKey } from "@/lib/sensitive-data";

/**
 * Tenant-bound, irreversible customer key shared by checkout orders, the
 * learner portal sign-in, CRM, consultations and automations. Every writer and
 * reader derives it here so the e-mail normalization (trim + lowercase) never
 * drifts between the order row and the portal lookup.
 *
 * Kept free of heavy imports so the order PII boundary can depend on it
 * without pulling in the automation runtime.
 */
export function automationCustomerKeyHash(vendorId: string, email: string) {
  const normalized = email.trim().toLowerCase();
  if (!vendorId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) throw new Error("Invalid automation customer identity.");
  return createHmac("sha256", deriveSensitiveDataKey("automation-customer-key-v1"))
    .update(`${vendorId}\n${normalized}`)
    .digest("base64url");
}
