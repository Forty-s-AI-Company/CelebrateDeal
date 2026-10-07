export type TrackingDeliveryMode = "test" | "live";
type BindingEnvironment = Readonly<Record<string, string | undefined>>;

/** 平台明確啟用單一模式；預設關閉，Preview 與正式模式不能互換。 */
export function resolveTrackingExecutorMode(environment: BindingEnvironment): TrackingDeliveryMode | null {
  const test = environment.META_TRACKING_TEST_DELIVERY_ENABLED === "true";
  const live = environment.META_TRACKING_LIVE_DELIVERY_ENABLED === "true";
  if (test && live) return null;
  if (environment.VERCEL_ENV === "preview" && test) return "test";
  if (environment.VERCEL_ENV === "production" && live) return "live";
  return null;
}

/** 任何直接 worker/transport 呼叫都不能繞過正式環境的明確啟用。 */
export function assertTrackingDeliveryBinding(mode: TrackingDeliveryMode, testEventCode: string | null): void {
  if (resolveTrackingExecutorMode(process.env) !== mode) throw new TypeError("Tracking execution is disabled.");
  if (mode === "test" && typeof testEventCode === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(testEventCode)) return;
  if (mode === "live" && testEventCode === null) return;
  throw new TypeError("Invalid tracking delivery mode binding.");
}
