// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
