import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prisma: vi.fn() }));
vi.mock("@prisma/client", async original => ({ ...await original<typeof import("@prisma/client")>(), PrismaClient: mocks.prisma }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); mocks.prisma.mockClear(); });
it.each(["DATABASE_URL", "DIRECT_URL"])("refuses non-loopback %s before constructing Prisma or registering write fixtures", async key => {
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test");
  vi.stubEnv("DIRECT_URL", "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test");
  vi.stubEnv(key, "postgresql://foreign.invalid/postgres");
  vi.resetModules();
  await expect(import("./q1-original-refund-proof.db.test")).rejects.toThrow(/database|loopback/i);
  expect(mocks.prisma).not.toHaveBeenCalled();
});
