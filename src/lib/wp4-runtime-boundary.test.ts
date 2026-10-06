import { describe, expect, it } from "vitest";
import { isWp4BoundNonProductionRuntime } from "./wp4-runtime-boundary";
const runtime = { VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox", WP4_SANDBOX_EXECUTOR_ENABLED: "true",
  WP4_DISPOSABLE_RUNNER_MARKER: "verified-loopback", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5544/celebratedeal_test",
  DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:5544/celebratedeal_test" };
describe("WP4 fixed runtime boundary", () => {
  it("admits only process-owned loopback disposable database and application", () => {
    expect(isWp4BoundNonProductionRuntime(runtime)).toBe(true);
  });
  it.each([
    { VERCEL_ENV: "production" }, { PAYUNI_ENV: "production" }, { VERCEL_PROJECT_ID: "other-project" },
    { WP4_DISPOSABLE_RUNNER_MARKER: "" }, { NEXT_PUBLIC_APP_URL: "https://customer.example" },
    { DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5544/customer" },
    { DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:5545/celebratedeal_test" },
  ])("rejects runtime drift %#", (drift) => expect(isWp4BoundNonProductionRuntime({ ...runtime, ...drift })).toBe(false));
});
