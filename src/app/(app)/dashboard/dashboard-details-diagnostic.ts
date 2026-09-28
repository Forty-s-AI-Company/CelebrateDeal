/** Test-only delay; deployed Preview and Production ignore caller input. */
export function parseDashboardDetailsDiagnosticDelay(value: string | undefined) {
  if (process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "true") return 0;
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 0;
}
