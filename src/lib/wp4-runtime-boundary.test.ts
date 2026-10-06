import { describe, expect, it } from "vitest";
import { isWp4BoundNonProductionRuntime, wp4RequestOriginMatches } from "./wp4-runtime-boundary";
const runtime = { VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox", WP4_SANDBOX_EXECUTOR_ENABLED: "true",
  WP4_DISPOSABLE_RUNNER_MARKER: "verified-loopback", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
  DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5544/celebratedeal_test",
  DIRECT_URL: "postgresql://synthetic:synthetic@127.0.0.1:5544/celebratedeal_test" };
describe("WP4 fixed runtime boundary", () => {
  it("binds an internal localhost alias to the exact disposable listener Host and port", () => {
    expect(wp4RequestOriginMatches(new Request("http://localhost:3100/api/ops", { headers: { host: "127.0.0.1:3100" } }), runtime)).toBe(true);
    for (const [target, host] of [["http://localhost:3101/api/ops", "127.0.0.1:3100"], ["http://other.example:3100/api/ops", "127.0.0.1:3100"], ["http://localhost:3100/api/ops", "other.example:3100"]]) {
      expect(wp4RequestOriginMatches(new Request(target!, { headers: { host: host! } }), runtime)).toBe(false);
    }
    expect(wp4RequestOriginMatches(new Request("http://localhost:3100/api/ops", { headers: { host: "127.0.0.1:3100" } }), { ...runtime, VERCEL_PROJECT_ID: "deployed" })).toBe(false);
  });
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
