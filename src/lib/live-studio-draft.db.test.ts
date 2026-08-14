import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";

const createdVendorIds: string[] = [];

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: createdVendorIds.splice(0) } } });
});

describe("Live Studio draft disposable database invariants", () => {
  it("returns the exact revision and timestamp produced by an optimistic draft write", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const vendor = await db.vendor.create({
      data: {
        name: `G7-44 Live Studio ${suffix}`,
        slug: `g7-44-live-studio-${suffix}`,
        email: `g7-44-live-studio-${suffix}@example.test`,
        passwordHash: "disposable-test-only",
      },
    });
    createdVendorIds.push(vendor.id);
    const draft = await db.liveStudioDraft.create({
      data: {
        vendorId: vendor.id,
        payload: { title: "第一個分頁", activeStep: 2 },
        revision: 7,
        updatedByMemberId: "synthetic-member",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const written = await db.liveStudioDraft.updateManyAndReturn({
      where: {
        id: draft.id,
        vendorId: vendor.id,
        liveId: null,
        revision: 7,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: {
        payload: { title: "本次寫入", activeStep: 3 },
        revision: { increment: 1 },
        updatedByMemberId: "synthetic-member",
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true, revision: true, updatedAt: true },
    });

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ id: draft.id, revision: 8, updatedAt: expect.any(Date) });
    expect(await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      payload: { title: "本次寫入", activeStep: 3 },
      revision: 8,
    });
  });

  it("claims a draft only when its revision and complete JSON payload still match", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const vendor = await db.vendor.create({
      data: {
        name: `G7-08 Live Studio ${suffix}`,
        slug: `g7-08-live-studio-${suffix}`,
        email: `g7-08-live-studio-${suffix}@example.test`,
        passwordHash: "disposable-test-only",
      },
    });
    createdVendorIds.push(vendor.id);

    const payload = {
      title: "可發布直播",
      slug: `sellable-live-${suffix}`,
      activeStep: 4,
      productIds: ["product-a"],
    } satisfies Prisma.InputJsonObject;
    const draft = await db.liveStudioDraft.create({
      data: {
        vendorId: vendor.id,
        payload,
        revision: 5,
        updatedByMemberId: "synthetic-member",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const staleClaim = await db.liveStudioDraft.updateMany({
      where: {
        id: draft.id,
        vendorId: vendor.id,
        liveId: null,
        revision: 5,
        payload: { equals: { ...payload, title: "過期分頁內容" } },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    expect(staleClaim.count).toBe(0);
    expect(await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      consumedAt: null,
      revision: 5,
    });

    const currentClaim = await db.liveStudioDraft.updateMany({
      where: {
        id: draft.id,
        vendorId: vendor.id,
        liveId: null,
        revision: 5,
        payload: { equals: payload },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    expect(currentClaim.count).toBe(1);
  });

  it("revives exactly one expired edit draft and never overwrites an active edit draft", async () => {
    const db = getDb();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const vendor = await db.vendor.create({
      data: {
        name: `G7-11 Stream allocation ${suffix}`,
        slug: `g7-11-stream-${suffix}`,
        email: `g7-11-stream-${suffix}@example.test`,
        passwordHash: "disposable-test-only",
      },
    });
    createdVendorIds.push(vendor.id);
    const live = await db.live.create({
      data: {
        vendorId: vendor.id,
        title: "Stream 分攤測試直播",
        slug: `g7-11-live-${suffix}`,
        scheduledAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    });
    const expiredPayload = { title: "過期草稿", activeStep: 3 } satisfies Prisma.InputJsonObject;
    const currentPayload = { title: "新草稿", activeStep: 3 } satisfies Prisma.InputJsonObject;
    const draft = await db.liveStudioDraft.create({
      data: {
        vendorId: vendor.id,
        liveId: live.id,
        payload: expiredPayload,
        revision: 4,
        updatedByMemberId: "synthetic-member",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const revived = await db.liveStudioDraft.updateMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }],
      },
      data: {
        payload: currentPayload,
        revision: { increment: 1 },
        consumedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    expect(revived.count).toBe(1);
    expect(await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      payload: currentPayload,
      revision: 5,
      consumedAt: null,
    });

    const staleSecondWriter = await db.liveStudioDraft.updateMany({
      where: {
        vendorId: vendor.id,
        liveId: live.id,
        OR: [{ expiresAt: { lte: new Date() } }, { consumedAt: { not: null } }],
      },
      data: { payload: expiredPayload, revision: { increment: 1 } },
    });
    expect(staleSecondWriter.count).toBe(0);
    expect(await db.liveStudioDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      payload: currentPayload,
      revision: 5,
    });
  });
});
