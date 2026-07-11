import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import {
  acceptVendorInvitation,
  createVendorInvitation,
  hashInvitationToken,
} from "@/lib/invitation";
import { hashPassword, verifyPassword } from "@/lib/password";

const vendorIds: string[] = [];
const userIds: string[] = [];

async function createWorkspace() {
  const suffix = randomUUID();
  const owner = await getDb().user.create({
    data: {
      email: `owner-${suffix}@example.test`,
      name: "Owner",
      passwordHash: "test",
    },
  });
  const vendor = await getDb().vendor.create({
    data: {
      name: `Invitation ${suffix}`,
      slug: `invitation-${suffix}`,
      email: `vendor-${suffix}@example.test`,
      passwordHash: "test",
    },
  });
  await getDb().vendorMember.create({
    data: { vendorId: vendor.id, userId: owner.id, role: "owner", status: "active" },
  });
  vendorIds.push(vendor.id);
  userIds.push(owner.id);
  return { owner, vendor, suffix };
}

afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  await getDb().user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});

describe("vendor invitation lifecycle", () => {
  it("stores only the SHA-256 token hash and rejects a duplicate active invitation", async () => {
    const { owner, vendor, suffix } = await createWorkspace();
    const email = `invitee-${suffix}@example.test`;
    const created = await createVendorInvitation({
      vendorId: vendor.id,
      email,
      role: "admin",
      invitedByUserId: owner.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stored = await getDb().vendorInvitation.findUniqueOrThrow({ where: { id: created.invitation.id } });
    expect(stored.tokenHash).toBe(hashInvitationToken(created.token));
    expect(stored.tokenHash).not.toBe(created.token);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(stored.acceptedAt).toBeNull();
    expect(stored.revokedAt).toBeNull();

    const duplicate = await createVendorInvitation({
      vendorId: vendor.id,
      email,
      role: "accountant",
      invitedByUserId: owner.id,
    });
    expect(duplicate).toEqual({ ok: false, reason: "unavailable" });
    await expect(getDb().vendorInvitation.count({ where: { vendorId: vendor.id, email } })).resolves.toBe(1);
  });

  it("rejects expired and tampered tokens without creating a user or membership", async () => {
    const { owner, vendor, suffix } = await createWorkspace();
    const email = `expired-${suffix}@example.test`;
    const now = new Date("2026-07-10T00:00:00.000Z");
    const created = await createVendorInvitation({
      vendorId: vendor.id,
      email,
      role: "accountant",
      invitedByUserId: owner.id,
      now,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(acceptVendorInvitation({
      token: `${created.token}tampered`,
      name: "New User",
      password: "strong-password-123",
      now,
    })).resolves.toEqual({ ok: false, reason: "invalid_or_expired" });

    await expect(acceptVendorInvitation({
      token: created.token,
      name: "New User",
      password: "strong-password-123",
      now: new Date(now.getTime() + 73 * 60 * 60 * 1000),
    })).resolves.toEqual({ ok: false, reason: "invalid_or_expired" });
    await expect(getDb().user.count({ where: { email } })).resolves.toBe(0);
  });

  it("adds an existing email user once and rejects token reuse", async () => {
    const { owner, vendor, suffix } = await createWorkspace();
    const password = "existing-password-123";
    const existingUser = await getDb().user.create({
      data: {
        email: `existing-${suffix}@example.test`,
        name: "Existing User",
        passwordHash: hashPassword(password),
      },
    });
    userIds.push(existingUser.id);
    const created = await createVendorInvitation({
      vendorId: vendor.id,
      email: existingUser.email,
      role: "admin",
      invitedByUserId: owner.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(acceptVendorInvitation({ token: created.token, password: "wrong-password" })).resolves.toEqual({
      ok: false,
      reason: "authentication_required",
    });
    const accepted = await acceptVendorInvitation({ token: created.token, password });
    expect(accepted.ok).toBe(true);
    await expect(acceptVendorInvitation({ token: created.token })).resolves.toEqual({
      ok: false,
      reason: "invalid_or_expired",
    });
    await expect(getDb().vendorMember.count({
      where: { vendorId: vendor.id, userId: existingUser.id, status: "active" },
    })).resolves.toBe(1);
  });

  it("creates a new user with a password hash and blocks inviting an active member", async () => {
    const { owner, vendor, suffix } = await createWorkspace();
    const email = `new-${suffix}@example.test`;
    const password = "strong-password-123";
    const created = await createVendorInvitation({
      vendorId: vendor.id,
      email,
      role: "accountant",
      invitedByUserId: owner.id,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const accepted = await acceptVendorInvitation({ token: created.token, name: "New User", password });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    userIds.push(accepted.userId);

    const user = await getDb().user.findUniqueOrThrow({ where: { id: accepted.userId } });
    expect(user.passwordHash).not.toBe(password);
    expect(verifyPassword(password, user.passwordHash)).toBe(true);

    await expect(createVendorInvitation({
      vendorId: vendor.id,
      email,
      role: "owner",
      invitedByUserId: owner.id,
    })).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});
