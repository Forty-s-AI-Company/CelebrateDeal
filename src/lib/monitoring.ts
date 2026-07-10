import * as Sentry from "@sentry/nextjs";

export function captureOperationalError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);

  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureException(error, { extra: context });
    return;
  }

  if (process.env.NODE_ENV !== "test") {
    console.error("[monitoring]", message, context ?? {});
  }
}
