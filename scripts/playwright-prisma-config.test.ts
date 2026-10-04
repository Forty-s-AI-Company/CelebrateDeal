import { afterEach, expect, it, vi } from "vitest";

const safe = "postgresql://synthetic:synthetic@127.0.0.1:54463/celebratedeal_test";
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

it("loads an explicit disposable target without reading dotenv", async () => {
  vi.stubEnv("DATABASE_URL", safe);
  vi.stubEnv("DIRECT_URL", safe);
  const config = await import("../prisma.playwright.config");
  if (!("datasource" in config.default)) throw new Error("Classic datasource missing");
  expect(config.default.datasource.url).toBe(safe);
});

it.each([
  ["DATABASE_URL", ""],
  ["DIRECT_URL", ""],
  ["DATABASE_URL", "postgresql://synthetic:synthetic@remote.example.test/celebratedeal_test"],
  ["DIRECT_URL", "postgresql://synthetic:synthetic@127.0.0.1/celebratedeal_dev"],
  ["DIRECT_URL", "postgresql://synthetic:synthetic@127.0.0.1/production"],
])("rejects unsafe %s before any migration can start", async (name, value) => {
  vi.stubEnv("DATABASE_URL", safe);
  vi.stubEnv("DIRECT_URL", safe);
  vi.stubEnv(name, value);
  await expect(import("../prisma.playwright.config")).rejects.toThrow(/rejected/u);
});
