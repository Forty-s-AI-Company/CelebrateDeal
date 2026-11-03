import type { Prisma } from "@prisma/client";

const SENSITIVE_KEY_PATTERN = /(authorization|password|secret|token|hashkey|hashiv|hashinfo|encryptinfo|streamkey|apikey|api_key|private|signature|card|cvv|email|e-mail|phone|mobile|address|recipient|buyer|customer|payer)/i;

function redactString(value: string) {
  return `[redacted length=${value.length}]`;
}

export function redactSensitivePayload(value: unknown, parentKey = "", depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 8) return "[redacted depth-limit]";

  if (typeof value === "string") {
    return SENSITIVE_KEY_PATTERN.test(parentKey) ? redactString(value) : value;
  }

  // F-068: aggregate ledger columns are BigInt, which JSON.stringify rejects.
  // Audit snapshots keep exact values: a number when it is a safe integer
  // (the existing JSON shape), otherwise its decimal string.
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitivePayload(item, parentKey, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, typeof item === "string" ? redactString(item) : "[redacted]"];
      }
      return [key, redactSensitivePayload(item, key, depth + 1)];
    }),
  );
}

export function redactedJsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(redactSensitivePayload(value ?? null))) as Prisma.InputJsonValue;
}
