import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLiveStudioDraft } from "@/lib/live-studio-draft";

const mocks = vi.hoisted(() => ({
  readJsonBody: vi.fn(),
  requireMerchantApiActor: vi.fn(),
  create: vi.fn(),
  updateManyAndReturn: vi.fn(),
  liveFindFirst: vi.fn(),
}));

vi.mock("@/lib/api-security", () => ({ readJsonBody: mocks.readJsonBody }));
vi.mock("@/lib/merchant-api-security", () => ({ requireMerchantApiActor: mocks.requireMerchantApiActor }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ liveStudioDraft: {
  create: mocks.create,
  updateManyAndReturn: mocks.updateManyAndReturn,
}, live: { findFirst: mocks.liveFindFirst } }) }));

import { POST } from "./route";

const payload = { ...emptyLiveStudioDraft(), title: "新品直播", activeStep: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMerchantApiActor.mockResolvedValue({ actor: { vendorId: "vendor-1", memberId: "member-1" } });
  mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, payload });
  mocks.create.mockResolvedValue({ id: "draft-1", revision: 1, updatedAt: new Date("2026-08-08T01:00:00.000Z") });
  mocks.updateManyAndReturn.mockResolvedValue([{ id: "draft-1", revision: 2, updatedAt: new Date("2026-08-08T01:01:00.000Z") }]);
  mocks.liveFindFirst.mockResolvedValue({ id: "live-1" });
});

function request() {
  return new Request("https://app.example.test/api/live-studio/drafts", { method: "POST" });
}

describe("POST /api/live-studio/drafts", () => {
  it("does not read the body before merchant authorization", async () => {
    mocks.requireMerchantApiActor.mockResolvedValue({ response: NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }) });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.readJsonBody).not.toHaveBeenCalled();
  });

  it("creates a tenant-owned revision one snapshot with a bounded expiry", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "draft-1", revision: 1, payload });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        liveId: null,
        updatedByMemberId: "member-1",
        payload,
        expiresAt: expect.any(Date),
      }),
      select: { id: true, revision: true, updatedAt: true },
    });
  });

  it("normalizes a legacy v1 payload once before persisting and responding", async () => {
    const { flowVersion, ...legacyPayload } = payload;
    expect(flowVersion).toBe(3);
    mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, payload: { ...legacyPayload, activeStep: 1 } });

    const response = await POST(request());

    // v1 step 1 (products) → v2 step 2 → 成交 (index 1).
    const canonicalPayload = expect.objectContaining({ flowVersion: 3, activeStep: 1, title: "新品直播" });
    await expect(response.json()).resolves.toMatchObject({ payload: canonicalPayload });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payload: canonicalPayload }),
    }));
  });

  it("stores an eight-step v2 payload from an older tab as v3 but answers in that tab's v2 shape", async () => {
    const versionTwoPayload = { ...payload, flowVersion: 2, activeStep: 5 };
    mocks.readJsonBody.mockResolvedValue({ draftId: "draft-1", revision: 1, payload: versionTwoPayload });

    const response = await POST(request());

    // v2 step 5 (Email) → 通知 (index 2) in the stored row.
    expect(mocks.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: { ...payload, flowVersion: 3, activeStep: 2 },
      }),
    }));
    // The eight-step client parses only flowVersion 2 and compares the response with what it sent.
    expect(response.status).toBe(200);
    const body = await response.json() as { revision: number; payload: unknown };
    expect(body.revision).toBe(2);
    expect(body.payload).toEqual(versionTwoPayload);
  });

  it("echoes the v2 step unchanged when an older tab saves from its last (review) step", async () => {
    const versionTwoPayload = { ...payload, flowVersion: 2, activeStep: 7 };
    mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, payload: versionTwoPayload });

    const response = await POST(request());

    // v2 step 7 (review) → 發布 (index 3) in the stored row.
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payload: { ...payload, flowVersion: 3, activeStep: 3 } }),
    }));
    await expect(response.json()).resolves.toMatchObject({ payload: versionTwoPayload });
  });

  it("answers a v3 request with the stored canonical v3 payload", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "draft-1", revision: 1, payload: { ...payload, activeStep: 3 } });

    const response = await POST(request());

    const canonicalPayload = { ...payload, flowVersion: 3, activeStep: 3 };
    expect(mocks.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payload: canonicalPayload }),
    }));
    const body = await response.json() as { payload: unknown };
    expect(body.payload).toEqual(canonicalPayload);
  });

  it("rejects a v3 payload whose step is outside the four-step studio", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, payload: { ...payload, activeStep: 4 } });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("updates only the matching current-vendor revision", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "draft-1", revision: 1, payload });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "draft-1", revision: 2 });
    expect(mocks.updateManyAndReturn).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "draft-1",
        vendorId: "vendor-1",
        revision: 1,
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      }),
      data: expect.objectContaining({ revision: { increment: 1 }, updatedByMemberId: "member-1" }),
      select: { id: true, revision: true, updatedAt: true },
    });
  });

  it("returns the exact revision produced by this write without a racy reread", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "draft-1", revision: 7, payload });
    mocks.updateManyAndReturn.mockResolvedValue([{
      id: "draft-1",
      revision: 8,
      updatedAt: new Date("2026-08-08T01:08:00.000Z"),
    }]);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "draft-1", revision: 8, payload });
    expect(mocks.updateManyAndReturn).toHaveBeenCalledOnce();
  });

  it("returns a recoverable conflict without overwriting a newer revision", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "draft-1", revision: 1, payload });
    mocks.updateManyAndReturn.mockResolvedValue([]);

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "DRAFT_CONFLICT" } });
  });

  it("maps a simultaneous first edit-draft unique race to a recoverable conflict", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "", liveId: "live-1", revision: null, payload });
    mocks.updateManyAndReturn.mockResolvedValue([]);
    mocks.create.mockRejectedValue(Object.assign(new Error("synthetic unique collision"), { code: "P2002" }));

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: { code: "DRAFT_CONFLICT" } });
  });

  it("revives an expired edit draft without overwriting a still-active writer", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "", liveId: "live-1", revision: null, payload });
    mocks.updateManyAndReturn.mockResolvedValue([{ id: "draft-expired", revision: 8, updatedAt: new Date("2026-08-08T01:01:00.000Z") }]);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "draft-expired", revision: 8, payload });
    expect(mocks.updateManyAndReturn).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        liveId: "live-1",
        OR: [
          { expiresAt: { lte: expect.any(Date) } },
          { consumedAt: { not: null } },
        ],
      },
      data: expect.objectContaining({
        payload,
        revision: { increment: 1 },
        consumedAt: null,
        updatedByMemberId: "member-1",
        expiresAt: expect.any(Date),
      }),
      select: { id: true, revision: true, updatedAt: true },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("binds edit drafts only to a live owned by the current vendor", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "", liveId: "foreign-live", revision: null, payload });
    mocks.liveFindFirst.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.liveFindFirst).toHaveBeenCalledWith({
      where: { id: "foreign-live", vendorId: "vendor-1" },
      select: { id: true },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects malformed or provider-owned fields before persistence", async () => {
    mocks.readJsonBody.mockResolvedValue({
      draftId: "",
      revision: null,
      payload: { ...payload, cloudflareLiveInputUid: "forged-provider-uid" },
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not expose raw database failures", async () => {
    mocks.create.mockRejectedValue(new Error("database-secret-response"));

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("DRAFT_SAVE_FAILED");
    expect(body).not.toContain("database-secret-response");
  });

  it("reports whether the live address is already used, scoped to other lives only", async () => {
    mocks.liveFindFirst.mockResolvedValue({ id: "someone-elses-live" });
    mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, payload: { ...payload, slug: "Friday Sale" } });

    const taken = await POST(request());

    await expect(taken.json()).resolves.toMatchObject({ slugTaken: true });
    expect(mocks.liveFindFirst).toHaveBeenCalledWith({ where: { slug: "friday-sale" }, select: { id: true } });

    mocks.liveFindFirst.mockResolvedValue(null);
    const free = await POST(request());
    await expect(free.json()).resolves.toMatchObject({ slugTaken: false });
  });

  it("skips the address check for an empty address and excludes the edited live", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, payload: { ...payload, slug: "" } });
    await expect((await POST(request())).json()).resolves.toMatchObject({ slugTaken: false });
    expect(mocks.liveFindFirst).not.toHaveBeenCalled();

    mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, liveId: "live-1", payload: { ...payload, slug: "mine" } });
    mocks.liveFindFirst.mockResolvedValue({ id: "live-1" });
    await expect((await POST(request())).json()).resolves.toMatchObject({ slugTaken: false });
    expect(mocks.liveFindFirst).toHaveBeenCalledWith({ where: { slug: "mine", id: { not: "live-1" } }, select: { id: true } });
  });

  it("still saves the draft and reports slugCheckFailed when the address lookup throws", async () => {
    mocks.liveFindFirst.mockRejectedValue(new Error("db down"));
    mocks.readJsonBody.mockResolvedValue({ draftId: "", revision: null, payload: { ...payload, slug: "my-live" } });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "draft-1", slugTaken: false, slugCheckFailed: true });
    expect(mocks.create).toHaveBeenCalled();
  });
});

describe("POST /api/live-studio/drafts overwrite (B07-20)", () => {
  it("skips only the revision comparison and keeps tenant, live and liveness bounds", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "draft-1", revision: 1, overwrite: true, payload });

    const response = await POST(request());

    expect(response.status).toBe(200);
    const where = mocks.updateManyAndReturn.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({ id: "draft-1", vendorId: "vendor-1", consumedAt: null, expiresAt: { gt: expect.any(Date) } });
    expect(where).not.toHaveProperty("revision");
  });

  it("still compares revisions when overwrite is not requested", async () => {
    mocks.readJsonBody.mockResolvedValue({ draftId: "draft-1", revision: 1, payload });
    await POST(request());
    expect(mocks.updateManyAndReturn.mock.calls[0]?.[0].where).toHaveProperty("revision", 1);
  });
});
