// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { resolveSentryEnvironment } from "./src/lib/sentry-environment";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: resolveSentryEnvironment(
    process.env.SENTRY_ENVIRONMENT,
    process.env.VERCEL_ENV,
    process.env.NODE_ENV,
  ),
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});
