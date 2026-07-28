import * as Sentry from "@sentry/nextjs";

export type OperationalErrorCategory =
  | "authentication"
  | "tls"
  | "network-timeout"
  | "connection-refused"
  | "provider-rejected"
  | "unknown";

type SafeOperationalDiagnostic = {
  category: OperationalErrorCategory;
  code: string;
};

const SAFE_CONTEXT_KEYS = new Set([
  "source",
  "operation",
  "environment",
  "provider",
  "checkedAt",
  "status",
]);
const SAFE_CONTEXT_VALUE = /^[A-Za-z0-9_.:@+-]{1,80}$/;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function classifyOperationalError(message: string): OperationalErrorCategory {
  if (/\b(tls|ssl|certificate|x509|handshake)\b/i.test(message)) return "tls";
  if (/\b(authentication failed|password authentication failed|invalid password|unauthorized)\b/i.test(message)) {
    return "authentication";
  }
  if (/\b(timeout|timed out|deadline has elapsed|aborterror)\b/i.test(message)) return "network-timeout";
  if (/\b(connection refused|econnrefused)\b/i.test(message)) return "connection-refused";
  if (/\b(provider[_ -]?rejected|upstream rejected|http (4|5)\d{2})\b/i.test(message)) {
    return "provider-rejected";
  }
  return "unknown";
}

function getSafeErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "unavailable";
  const code = String(error.code);
  return /^(P\d{4}|E[A-Z0-9_]{2,31})$/.test(code) ? code : "unavailable";
}

function getSafeDiagnostic(error: unknown): SafeOperationalDiagnostic {
  return {
    // The original message is inspected only to choose a fixed enum. It is
    // never included in Sentry, console output, or the public response.
    category: classifyOperationalError(getErrorMessage(error)),
    code: getSafeErrorCode(error),
  };
}

function getSafeContext(context: Record<string, unknown> | undefined) {
  if (!context) return {};

  return Object.entries(context).reduce<Record<string, string | number | boolean>>(
    (safeContext, [key, value]) => {
      if (!SAFE_CONTEXT_KEYS.has(key)) return safeContext;
      if (typeof value === "number" && Number.isFinite(value)) {
        safeContext[key] = value;
      } else if (typeof value === "boolean") {
        safeContext[key] = value;
      } else if (typeof value === "string" && SAFE_CONTEXT_VALUE.test(value)) {
        safeContext[key] = value;
      }
      return safeContext;
    },
    {},
  );
}

export function captureOperationalError(error: unknown, context?: Record<string, unknown>) {
  const safePayload = {
    event: "operational_error",
    ...getSafeDiagnostic(error),
    ...getSafeContext(context),
  };

  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    const safeError = new Error("Operational error");
    safeError.name = "OperationalError";
    Sentry.captureException(safeError, { extra: safePayload });
    return;
  }

  if (process.env.NODE_ENV !== "test") {
    console.error("operational_error", safePayload);
  }
}
