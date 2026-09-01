import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma, User, VendorMember } from "@prisma/client";
import { getDb } from "@/lib/db";
import { decryptMfaSecret } from "@/lib/mfa";
import { verifyPasswordAsync } from "@/lib/password";

export const AUTH_COOKIE = "celebrate_session";
export const LEGACY_VENDOR_COOKIE = "celebrate_vendor_id";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
export const WP4_PREVIEW_SESSION_TTL_SECONDS = 15 * 60;
const FINANCE_ROLES = ["owner", "admin", "accountant"] as const;
const VENDOR_MANAGER_ROLES = ["owner", "admin"] as const;
const VENDOR_SUPPORT_ROLES = ["owner", "admin", "support"] as const;
const PLATFORM_ROLES = ["platform_admin"] as const;
const ACTIVE_MEMBER_STATUS = "active";
// A fixed, valid scrypt record makes unknown-account logins perform the same
// asynchronous password derivation as known accounts without creating a
// request-time synchronous hash.
const DUMMY_PASSWORD_HASH =
  "scrypt:000102030405060708090a0b0c0d0e0f:65c37c85e9aefa50a1f444621f7edb56f3b1e94a9ef3928cb01f59a6153d44286c55fb3532d67eb6f759e734c8c06a07918d5ae25593811db1727a668938246d";

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

export function sessionCookieOptions(expiresAt?: Date, maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
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

function safeMfaNextPath(value: string, fallback = "/billing/usage") {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : fallback;
}

function chooseVendor(user: UserWithMemberships, sessionVendorId?: string | null) {
  const activeMemberships = user.memberships.filter((membership) => membership.status === ACTIVE_MEMBER_STATUS);
  const selected = sessionVendorId
    ? activeMemberships.find((membership) => membership.vendorId === sessionVendorId)
    : null;
  return selected ?? activeMemberships[0] ?? null;
}

async function createSession({
  userId,
  vendorId,
  ipAddress,
  userAgent,
  mfaVerifiedAt = null,
  ttlSeconds = SESSION_TTL_SECONDS,
  updateLastLogin = true,
}: {
  userId: string;
  vendorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  mfaVerifiedAt?: Date | null;
  ttlSeconds?: number;
  updateLastLogin?: boolean;
}) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await getDb().userSession.create({
    data: {
      userId,
      vendorId: vendorId ?? null,
      tokenHash: sessionTokenHash(token),
      ipAddress,
      userAgent,
      // 呼叫端只能在已完成其自身驗證流程後指定此值；與 session 建立同一筆
      // insert，避免先建立未驗證 session 再補寫的短暫狀態。
      mfaVerifiedAt,
      expiresAt,
    },
  });

  if (updateLastLogin) {
    await getDb().user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  return { token, expiresAt };
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
  // 一般登入流程永遠從未通過 MFA 的 session 開始；不得由一般 caller 覆寫。
  return createSession({ userId, vendorId, ipAddress, userAgent, mfaVerifiedAt: null });
}

/**
 * WP4 受控 Preview runner 專用。此 guard 放在 session helper 內，避免 route
 * 以外的任何一般產品呼叫端取得建立 MFA-verified session 的能力。
 */
export async function createWp4PreviewMfaVerifiedSession({
  userId,
  vendorId,
}: {
  userId: string;
  vendorId: string;
}) {
  if (
    process.env.VERCEL_ENV !== "preview"
    || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true"
  ) {
    throw new Error("WP4 preview session creation is disabled");
  }

  return createSession({
    userId,
    vendorId,
    mfaVerifiedAt: new Date(),
    ttlSeconds: WP4_PREVIEW_SESSION_TTL_SECONDS,
    updateLastLogin: false,
  });
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

export async function requireVendorContext() {
  const auth = await requireAuth();
  if (!auth.vendor) {
    redirect(auth.isPlatformAdmin ? "/admin/billing/dashboard" : "/login?error=no_vendor");
  }

  return {
    auth,
    vendor: auth.vendor as VendorWithTracking,
  };
}

export async function requireVendor() {
  return (await requireVendorContext()).vendor;
}

export async function requireVendorManagerContext() {
  const { auth, vendor } = await requireVendorContext();
  const role = auth.member?.role;
  if (
    !auth.member
    || auth.member.status !== ACTIVE_MEMBER_STATUS
    || !VENDOR_MANAGER_ROLES.includes(role as (typeof VENDOR_MANAGER_ROLES)[number])
  ) {
    redirect("/dashboard?error=insufficient_role");
  }

  return { auth, vendor };
}

export async function requireVendorManager() {
  return (await requireVendorManagerContext()).vendor;
}

export async function requireVendorSupportContext() {
  const { auth, vendor } = await requireVendorContext();
  const role = auth.member?.role;
  if (
    !auth.member
    || auth.member.status !== ACTIVE_MEMBER_STATUS
    || !VENDOR_SUPPORT_ROLES.includes(role as (typeof VENDOR_SUPPORT_ROLES)[number])
  ) {
    redirect("/dashboard?error=insufficient_role");
  }

  return { auth, vendor };
}

export async function requireVendorSupportMfa(nextPath = "/support-cases") {
  const { auth, vendor } = await requireVendorSupportContext();

  if (!auth.user.mfaFactor) {
    redirect("/mfa/setup");
  }

  if (!auth.isMfaVerified) {
    const safeNext = safeMfaNextPath(nextPath, "/support-cases");
    redirect(`/mfa/verify?next=${encodeURIComponent(safeNext)}`);
  }

  return {
    auth,
    user: auth.user,
    vendor,
    member: auth.member!,
  };
}

export async function requireVendorManagerMfa(nextPath = "/orders") {
  const { auth, vendor } = await requireVendorManagerContext();

  if (!auth.user.mfaFactor) {
    redirect("/mfa/setup");
  }

  if (!auth.isMfaVerified) {
    const safeNext = safeMfaNextPath(nextPath, "/orders");
    redirect(`/mfa/verify?next=${encodeURIComponent(safeNext)}`);
  }

  return {
    auth,
    user: auth.user,
    vendor,
    member: auth.member!,
  };
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

export async function requireVendorFinance(nextPath = "/billing/usage") {
  const { auth, vendor } = await requireVendorContext();
  const member = auth.member;

  if (
    !member
    || member.status !== ACTIVE_MEMBER_STATUS
    || !isFinanceRole(member.role)
  ) {
    redirect("/dashboard?error=insufficient_role");
  }

  if (!auth.user.mfaFactor) {
    redirect("/mfa/setup");
  }

  if (!auth.isMfaVerified) {
    const safeNext = safeMfaNextPath(nextPath);
    redirect(`/mfa/verify?next=${encodeURIComponent(safeNext)}`);
  }

  return {
    user: auth.user,
    vendor,
    member,
  };
}

export async function requireVendorOwnerFinance(nextPath = "/billing/plans") {
  const context = await requireVendorFinance(nextPath);
  if (context.member.role !== "owner") {
    redirect("/settings/security?error=owner_required");
  }

  return context;
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

  const passwordMatches = await verifyPasswordAsync(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !isActiveUser(user) || !passwordMatches) {
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
