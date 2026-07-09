export function captureOperationalError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error);

  // Sentry SDK can be wired here after the production project is created.
  if (!process.env.SENTRY_DSN) {
    console.error("[monitoring]", message, context ?? {});
    return;
  }

  console.error("[sentry-pending-sdk]", message, context ?? {});
}
