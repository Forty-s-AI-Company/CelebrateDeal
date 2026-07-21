import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma, User, VendorMember } from "@prisma/client";
import { getDb } from "@/lib/db";
import { decryptMfaSecret } from "@/lib/mfa";
import { verifyPassword } from "@/lib/password";

export const AUTH_COOKIE = "celebrate_session";
export const LEGACY_VENDOR_COOKIE = "celebrate_vendor_id";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const FINANCE_ROLES = ["owner", "admin", "accountant"] as const;
const PLATFORM_ROLES = ["platform_admin"] as const;
const ACTIVE_MEMBER_STATUS = "active";

type VendorWithTracking = Prisma.VendorGetPayload<{ include: { tracking: true } }>;
type UserWithMemberships = Prisma.UserGetPayload<{
  include: { memberships: { include: { vendor: { include: { tracking: true } } } }; mfaFactor: true; recoveryCodes: true };
}>;

export type FinanceActor = Pick<VendorMember, "id" | "role"> | { id: string; role: "platform_admin" };

function sessionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function sessionCookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    expires: expiresAt,
  };
}

function isActiveUser(user: Pick<User, "status">) {
  return user.status === "active";
}

function isPlatformAdmin(user: Pick<User, "platformRole">) {
  return PLATFORM_ROLES.includes(user.platformRole as (typeof PLATFORM_ROLES)[number]);
}

function isFinanceRole(role?: string | null) {
  return Boolean(role && FINANCE_ROLES.includes(role as (typeof FINANCE_ROLES)[number]));
}

function requiresAdminMfa(input: {
  isPlatformAdmin: boolean;
  memberRole?: string | null;
}) {
  return input.isPlatformAdmin || isFinanceRole(input.memberRole);
}

function chooseVendor(user: UserWithMemberships, sessionVendorId?: string | null) {
  const activeMemberships = user.memberships.filter((membership) => membership.status === ACTIVE_MEMBER_STATUS);
  const selected = sessionVendorId
    ? activeMemberships.find((membership) => membership.vendorId === sessionVendorId)
    : null;
  return selected ?? activeMemberships[0] ?? null;
}

export async function createUserSession({
  userId,
  vendorId,
  ipAddress,
  userAgent,
}: {
  userId: string;
  vendorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await getDb().userSession.create({
    data: {
      userId,
      vendorId: vendorId ?? null,
      tokenHash: sessionTokenHash(token),
      ipAddress,
      userAgent,
      mfaVerifiedAt: null,
      expiresAt,
    },
  });

  await getDb().user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });

  return { token, expiresAt };
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (token) {
    await getDb().userSession.updateMany({
      where: {
        tokenHash: sessionTokenHash(token),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }
}

export async function getCurrentAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await getDb().userSession.findUnique({
    where: { tokenHash: sessionTokenHash(token) },
    include: {
      user: {
        include: {
          memberships: {
            include: { vendor: { include: { tracking: true } } },
            orderBy: { createdAt: "asc" },
          },
          mfaFactor: true,
          recoveryCodes: true,
        },
      },
      vendor: { include: { tracking: true } },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date() || !isActiveUser(session.user)) {
    return null;
  }

  const selectedMembership = chooseVendor(session.user, session.vendorId);
  const vendor = selectedMembership?.vendor ?? null;

  return {
    session,
    user: session.user,
    vendor,
    member: selectedMembership,
    isPlatformAdmin: isPlatformAdmin(session.user),
    requiresAdminMfa: requiresAdminMfa({
      isPlatformAdmin: isPlatformAdmin(session.user),
      memberRole: selectedMembership?.role,
    }),
    isMfaVerified: Boolean(session.mfaVerifiedAt),
  };
}

export async function getCurrentVendor() {
  const auth = await getCurrentAuth();
  return auth?.vendor ?? null;
}

export async function requireAuth() {
  const auth = await getCurrentAuth();
  if (!auth) {
    redirect("/login");
  }
  return auth;
}

export async function requireVendor() {
  const auth = await requireAuth();
  if (!auth.vendor) {
    redirect(auth.isPlatformAdmin ? "/admin/billing/dashboard" : "/login?error=no_vendor");
  }

  return auth.vendor as VendorWithTracking;
}

export async function requireFinanceAdmin() {
  const auth = await requireAuth();

  // `/admin`、退款、月結、出款與 webhook 重送都是平台層級操作。
  // 商家 owner/admin/accountant 另有 tenant-scoped `/billing` 畫面，不能因
  // 角色名稱含財務權限就取得跨商家的平台後台資料。
  if (!auth.isPlatformAdmin) {
    redirect("/dashboard");
  }

  if (auth.requiresAdminMfa) {
    if (!auth.user.mfaFactor) {
      redirect("/mfa/setup");
    }

    if (!auth.isMfaVerified) {
      redirect("/mfa/verify?next=%2Fadmin%2Fbilling%2Fdashboard");
    }
  }

  return {
    user: auth.user,
    vendor: auth.vendor,
    member: { id: auth.user.id, role: "platform_admin" } as FinanceActor,
    isPlatformAdmin: true,
  };
}

export async function requireVendorOwner() {
  const auth = await requireAuth();

  if (!auth.vendor || !auth.member || auth.member.status !== ACTIVE_MEMBER_STATUS || auth.member.role !== "owner") {
    redirect("/settings/security?error=owner_required");
  }

  return {
    user: auth.user,
    vendor: auth.vendor,
    member: auth.member,
  };
}

export async function authenticateUser(email: string, password: string) {
  const user = await getDb().user.findUnique({
    where: { email },
    include: {
      memberships: {
        include: { vendor: { include: { tracking: true } } },
        orderBy: { createdAt: "asc" },
      },
      mfaFactor: true,
      recoveryCodes: true,
    },
  });

  if (!user || !isActiveUser(user) || !verifyPassword(password, user.passwordHash)) {
    return null;
  }

  const membership = chooseVendor(user);
  return {
    user,
    vendor: membership?.vendor ?? null,
    member: membership,
    isPlatformAdmin: isPlatformAdmin(user),
    requiresAdminMfa: requiresAdminMfa({
      isPlatformAdmin: isPlatformAdmin(user),
      memberRole: membership?.role,
    }),
  };
}

export async function markCurrentSessionMfaVerified() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE)?.value;
  if (!token) {
    return;
  }

  await getDb().userSession.updateMany({
    where: {
      tokenHash: sessionTokenHash(token),
      revokedAt: null,
    },
    data: { mfaVerifiedAt: new Date() },
  });
}

export async function getCurrentUserMfaSecret(userId: string) {
  const factor = await getDb().userMfaFactor.findUnique({ where: { userId } });
  return factor ? decryptMfaSecret(factor.secretEncrypted) : null;
}
