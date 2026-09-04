import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
import { resolveWp4ExpectedSourceSha } from "./wp4-preview-runtime";

export const WP4_OWNER_SESSION_TTL = 15 * 60;

/** Fixed synthetic owner only; ordinary login/MFA remains unchanged. */
export async function createWp4PreviewOwnerSession(db: PrismaClient) {
  if (process.env.VERCEL_ENV !== "preview" || process.env.PAYUNI_ENV !== "sandbox"
    || process.env.WP4_SANDBOX_EXECUTOR_ENABLED !== "true" || !resolveWp4ExpectedSourceSha()) {
    throw new Error("Preview owner session unavailable");
  }
  return db.$transaction(async (tx) => {
    const member = await tx.vendorMember.findFirst({
      where: {
        vendorId: WP4_SANDBOX_FIXTURE.vendorId, userId: WP4_SANDBOX_FIXTURE.userId,
        role: "owner", status: "active",
        user: { status: "active", platformRole: "none", email: WP4_SANDBOX_FIXTURE.userEmail },
        vendor: { slug: WP4_SANDBOX_FIXTURE.vendorSlug },
      },
      select: { id: true },
    });
    if (!member) throw new Error("Preview owner session unavailable");
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + WP4_OWNER_SESSION_TTL * 1000);
    await tx.userSession.create({ data: {
      userId: WP4_SANDBOX_FIXTURE.userId, vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      mfaVerifiedAt: now, expiresAt,
    } });
    // Token exists only in memory until the protected route sets HttpOnly cookie.
    return { token, expiresAt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
