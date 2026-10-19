// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { resolveSentryEnvironment } from "./src/lib/sentry-environment";
import {
  resolveTraceSampleRate,
  sentryBeforeBreadcrumb,
  sentryBeforeSend,
  sentryBeforeSendLog,
  sentryBeforeSendTransaction,
  sentryDataCollection,
} from "./src/lib/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: resolveSentryEnvironment(
    process.env.SENTRY_ENVIRONMENT,
    process.env.VERCEL_ENV,
    process.env.NODE_ENV,
  ),
  // 輪詢類 route 幾乎不取樣，付款／結帳／webhook 全取樣（F-098）。
  tracesSampler: ({ name, attributes, inheritOrSampleWith }) => inheritOrSampleWith(
    resolveTraceSampleRate({ name, attributes }, process.env.NODE_ENV === "development"),
  ),
  enableLogs: true,
  // 不送 cookies、網址參數、request body、堆疊變數與 PII；headers 只留白名單（F-143）。
  // 不設定已棄用的 sendDefaultPii（預設為 false，且與 dataCollection 並存時會被忽略）。
  dataCollection: sentryDataCollection,
  beforeSend: sentryBeforeSend,
  beforeSendTransaction: sentryBeforeSendTransaction,
  beforeBreadcrumb: sentryBeforeBreadcrumb,
  beforeSendLog: sentryBeforeSendLog,
});
