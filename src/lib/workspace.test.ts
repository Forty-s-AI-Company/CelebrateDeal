import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { canInviteWorkspaceOwner, deactivateWorkspaceMember, switchCurrentWorkspace } from "@/lib/workspace";

const vendorIds: string[] = [];
const userIds: string[] = [];

async function createVendor(label: string, suffix: string) {
  const vendor = await getDb().vendor.create({
    data: {
      name: label,
      slug: `${label.toLowerCase()}-${suffix}`,
      email: `${label.toLowerCase()}-${suffix}@example.test`,
      passwordHash: "test",
    },
  });
  vendorIds.push(vendor.id);
  return vendor;
}

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await getDb().user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

describe("workspace switching", () => {
  it("updates only the current user's active membership and rejects another tenant", async () => {
    const suffix = randomUUID();
    const user = await getDb().user.create({
      data: {
        email: `workspace-${suffix}@example.test`,
        name: "Workspace User",
        passwordHash: "test",
      },
    });
    userIds.push(user.id);
    const [first, second, unauthorized] = await Promise.all([
      createVendor("First", suffix),
      createVendor("Second", suffix),
      createVendor("Unauthorized", suffix),
    ]);
    await getDb().vendorMember.createMany({
      data: [
        { vendorId: first.id, userId: user.id, role: "admin", status: "active" },
        { vendorId: second.id, userId: user.id, role: "accountant", status: "active" },
      ],
    });
    const session = await getDb().userSession.create({
      data: {
        userId: user.id,
        vendorId: first.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(switchCurrentWorkspace({
      sessionId: session.id,
      userId: user.id,
      vendorId: second.id,
    })).resolves.toBe(true);
    await expect(getDb().userSession.findUniqueOrThrow({ where: { id: session.id } }))
      .resolves.toMatchObject({ vendorId: second.id });

    await expect(switchCurrentWorkspace({
      sessionId: session.id,
      userId: user.id,
      vendorId: unauthorized.id,
    })).resolves.toBe(false);
    await expect(getDb().userSession.findUniqueOrThrow({ where: { id: session.id } }))
      .resolves.toMatchObject({ vendorId: second.id });
  });
});

describe("owner invitation step-up", () => {
  it("requires both an enrolled factor and current-session verification", () => {
    const now = new Date("2026-07-11T00:10:00Z");
    expect(canInviteWorkspaceOwner({ hasMfaFactor: false, mfaVerifiedAt: now, now })).toBe(false);
    expect(canInviteWorkspaceOwner({ hasMfaFactor: true, mfaVerifiedAt: null, now })).toBe(false);
    expect(canInviteWorkspaceOwner({ hasMfaFactor: true, mfaVerifiedAt: new Date("2026-07-11T00:00:01Z"), now })).toBe(true);
    expect(canInviteWorkspaceOwner({ hasMfaFactor: true, mfaVerifiedAt: new Date("2026-07-10T23:59:59Z"), now })).toBe(false);
  });
});

describe("last owner concurrency", () => {
  it("keeps one active owner when two owners deactivate each other concurrently", async () => {
    const suffix = randomUUID();
    const vendor = await createVendor("OwnerRace", suffix);
    const [firstUser, secondUser] = await Promise.all([
      getDb().user.create({ data: { email: `owner-a-${suffix}@example.test`, name: "Owner A", passwordHash: "test" } }),
      getDb().user.create({ data: { email: `owner-b-${suffix}@example.test`, name: "Owner B", passwordHash: "test" } }),
    ]);
    userIds.push(firstUser.id, secondUser.id);
    const [firstMember, secondMember] = await Promise.all([
      getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: firstUser.id, role: "owner", status: "active" } }),
      getDb().vendorMember.create({ data: { vendorId: vendor.id, userId: secondUser.id, role: "owner", status: "active" } }),
    ]);

    const results = await Promise.all([
      deactivateWorkspaceMember({ vendorId: vendor.id, actorUserId: firstUser.id, targetMemberId: secondMember.id }),
      deactivateWorkspaceMember({ vendorId: vendor.id, actorUserId: secondUser.id, targetMemberId: firstMember.id }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    await expect(getDb().vendorMember.count({ where: { vendorId: vendor.id, role: "owner", status: "active" } })).resolves.toBe(1);
  });
});
