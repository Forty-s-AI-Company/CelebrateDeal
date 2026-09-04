import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  ensureWp4SandboxFixture,
  WP4_SANDBOX_FIXTURE,
  Wp4SandboxFixtureConflictError,
} from "./wp4-sandbox-fixture";

function fixtureDb(overrides: Record<string, unknown> = {}) {
  const transactionDb = {
    vendor: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    user: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    vendorMember: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    product: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    billingPlan: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    invoice: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    ...overrides,
  };
  const db = {
    $transaction: vi.fn(async (callback: (tx: typeof transactionDb) => unknown) => callback(transactionDb)),
  } as unknown as PrismaClient;
  return { db, transactionDb };
}

describe("ensureWp4SandboxFixture", () => {
  it("creates only the five deterministic synthetic fixture identities", async () => {
    const { db, transactionDb } = fixtureDb();

    await expect(ensureWp4SandboxFixture(db)).resolves.toEqual({ createdCount: 5, reusedCount: 0 });

    expect(transactionDb.vendor.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: WP4_SANDBOX_FIXTURE.vendorId,
        slug: WP4_SANDBOX_FIXTURE.vendorSlug,
        email: WP4_SANDBOX_FIXTURE.vendorEmail,
      }),
    }));
    expect(transactionDb.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: WP4_SANDBOX_FIXTURE.userId, email: WP4_SANDBOX_FIXTURE.userEmail }),
    }));
    expect(transactionDb.product.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: WP4_SANDBOX_FIXTURE.productId, vendorId: WP4_SANDBOX_FIXTURE.vendorId }),
    }));
    expect(transactionDb.billingPlan.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: WP4_SANDBOX_FIXTURE.planId, code: WP4_SANDBOX_FIXTURE.planCode }),
    }));
    expect(transactionDb.invoice.create).not.toHaveBeenCalled();
  });

  it("reuses and repairs only rows whose complete synthetic identity matches", async () => {
    const { db, transactionDb } = fixtureDb({
      vendor: {
        findFirst: vi.fn().mockResolvedValue({
          id: WP4_SANDBOX_FIXTURE.vendorId,
          slug: WP4_SANDBOX_FIXTURE.vendorSlug,
          email: WP4_SANDBOX_FIXTURE.vendorEmail,
        }),
        create: vi.fn(),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: WP4_SANDBOX_FIXTURE.userId,
          email: WP4_SANDBOX_FIXTURE.userEmail,
          name: "WP4 Synthetic Sandbox Owner",
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
      vendorMember: { findUnique: vi.fn().mockResolvedValue({ id: "synthetic-member" }), create: vi.fn(), update: vi.fn() },
      product: {
        findFirst: vi.fn().mockResolvedValue({
          id: WP4_SANDBOX_FIXTURE.productId,
          vendorId: WP4_SANDBOX_FIXTURE.vendorId,
          slug: WP4_SANDBOX_FIXTURE.productSlug,
          name: "WP4 Synthetic Sandbox Product",
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
      billingPlan: {
        findFirst: vi.fn().mockResolvedValue({
          id: WP4_SANDBOX_FIXTURE.planId,
          code: WP4_SANDBOX_FIXTURE.planCode,
          name: "WP4 Synthetic Sandbox Plan",
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
    });

    await expect(ensureWp4SandboxFixture(db)).resolves.toEqual({ createdCount: 0, reusedCount: 5 });
    expect(transactionDb.user.update).toHaveBeenCalledOnce();
    expect(transactionDb.vendorMember.update).toHaveBeenCalledOnce();
    expect(transactionDb.product.update).toHaveBeenCalledOnce();
    expect(transactionDb.billingPlan.update).toHaveBeenCalledOnce();
    expect(transactionDb.invoice.update).not.toHaveBeenCalled();
  });

  it("never reads, creates, or rewrites an existing synthetic invoice", async () => {
    const { db, transactionDb } = fixtureDb();
    transactionDb.invoice.findFirst.mockResolvedValue({
      id: WP4_SANDBOX_FIXTURE.invoiceId,
      status: "paid",
      paidAt: new Date("2026-09-01T00:00:00.000Z"),
    });

    await ensureWp4SandboxFixture(db);

    expect(transactionDb.invoice.findFirst).not.toHaveBeenCalled();
    expect(transactionDb.invoice.create).not.toHaveBeenCalled();
    expect(transactionDb.invoice.update).not.toHaveBeenCalled();
  });

  it("fails closed before writes when a deterministic identity collides", async () => {
    const { db, transactionDb } = fixtureDb({
      vendor: {
        findFirst: vi.fn().mockResolvedValue({
          id: WP4_SANDBOX_FIXTURE.vendorId,
          slug: "customer-owned-slug",
          email: "customer@example.test",
        }),
        create: vi.fn(),
      },
    });

    await expect(ensureWp4SandboxFixture(db)).rejects.toBeInstanceOf(Wp4SandboxFixtureConflictError);
    expect(transactionDb.vendor.create).not.toHaveBeenCalled();
    expect(transactionDb.user.create).not.toHaveBeenCalled();
  });
});
