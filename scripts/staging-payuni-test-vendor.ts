import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { getStagingDatabaseIdentityReport, isStagingDatabaseUrl } from "../src/lib/database-identity";
import { hashPasswordAsync } from "../src/lib/password";
import { PAYUNI_STAGING_APP_ORIGIN } from "../src/lib/payuni-staging-plan-test";

const TEST_VENDOR_SLUG = "payuni-plan-test";
const TEST_ACCOUNT_EMAIL = "zeroyuanbrothers@gmail.com";

/** A staging-only bootstrap. Passwords remain unknown until the owner uses the normal reset flow. */
export function validateStagingTestVendorTarget(env: NodeJS.ProcessEnv) {
  let directPort = false;
  try {
    const url = new URL(env.STAGING_DATABASE_URL ?? "");
    directPort = url.port === "5432";
  } catch { /* Generic guard below avoids printing a connection string. */ }
  const email = env.STAGING_PAYUNI_TEST_ACCOUNT_EMAIL?.trim().toLowerCase() ?? "";
  if (env.VERCEL_ENV !== "preview"
    || env.NEXT_PUBLIC_APP_URL !== PAYUNI_STAGING_APP_ORIGIN
    || !getStagingDatabaseIdentityReport(env).all_passed
    || !isStagingDatabaseUrl(env.STAGING_DATABASE_URL)
    || !directPort
    || env.PAYUNI_STAGING_PLAN_TEST_ENABLED !== "false"
    || env.STAGING_PAYUNI_TEST_VENDOR_CHANGE_APPROVED !== "true"
    || email !== TEST_ACCOUNT_EMAIL) {
    throw new Error("Isolated staging test vendor target and recovery gate are not verified.");
  }
  return { email, name: env.STAGING_PAYUNI_TEST_ACCOUNT_NAME?.trim() || "Staging PAYUNi Test Owner" };
}

/** Creates one dedicated vendor and owner; never changes an existing account or vendor. */
export async function createStagingPayUniTestVendor(
  db: PrismaClient,
  input: { email: string; name: string },
) {
  // Random, undisclosed passwords ensure only the account owner's reset email can enable login.
  const [vendorPasswordHash, userPasswordHash] = await Promise.all([
    hashPasswordAsync(randomBytes(48).toString("base64url")),
    hashPasswordAsync(randomBytes(48).toString("base64url")),
  ]);
  return db.$transaction(async (tx) => {
    const [existingVendor, existingUser] = await Promise.all([
      tx.vendor.findFirst({ where: { OR: [{ slug: TEST_VENDOR_SLUG }, { email: input.email }] }, select: { id: true } }),
      tx.user.findUnique({ where: { email: input.email }, select: { id: true } }),
    ]);
    if (existingVendor || existingUser) {
      throw new Error("The designated staging test account or vendor already exists; reconcile it before proceeding.");
    }
    const vendor = await tx.vendor.create({ data: {
      name: "PAYUNi Staging Plan Test",
      slug: TEST_VENDOR_SLUG,
      email: input.email,
      passwordHash: vendorPasswordHash,
      tracking: { create: {} },
    }, select: { id: true } });
    const user = await tx.user.create({ data: {
      email: input.email,
      name: input.name,
      passwordHash: userPasswordHash,
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
    }, select: { id: true } });
    await tx.auditLog.create({ data: {
      vendorId: vendor.id,
      actorLabel: "staging-bootstrap",
      action: "create_staging_payuni_test_vendor",
      targetType: "Vendor",
      targetId: vendor.id,
      after: { userId: user.id, purpose: "payuni-staging-plan-test" },
    } });
    return { vendorId: vendor.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function main() {
  const input = validateStagingTestVendorTarget(process.env);
  const db = new PrismaClient({ datasources: { db: { url: process.env.STAGING_DATABASE_URL } }, log: [] });
  try {
    await createStagingPayUniTestVendor(db, input);
    process.stdout.write("Dedicated staging test vendor created; login remains locked until account-owner password reset.\n");
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1]?.endsWith("staging-payuni-test-vendor.ts")) {
  main().catch(() => {
    process.stderr.write("Staging test vendor creation did not pass its safety checks.\n");
    process.exitCode = 1;
  });
}
