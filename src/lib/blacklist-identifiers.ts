import { isIP } from "node:net";
import { z } from "zod";

export const BlacklistIdentifierType = z.enum(["email", "phone", "ip", "visitor_id"]);
export type BlacklistIdentifierTypeValue = z.infer<typeof BlacklistIdentifierType>;

const emailAddress = z.string().email().max(320);
const visitorId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

/** Keep stored blacklist values in the same representation used by public routes. */
export function normalizeBlacklistIdentifier(type: BlacklistIdentifierTypeValue, input: string) {
  const value = input.trim();
  if (type === "email") {
    const normalized = value.toLowerCase();
    return emailAddress.safeParse(normalized).success ? normalized : null;
  }
  if (type === "phone") {
    const normalized = value.replace(/[\s().-]/g, "");
    return /^\+?[0-9]{8,20}$/.test(normalized) ? normalized : null;
  }
  if (type === "ip") {
    return isIP(value) ? value.toLowerCase() : null;
  }
  return visitorId.safeParse(value).success ? value : null;
}
