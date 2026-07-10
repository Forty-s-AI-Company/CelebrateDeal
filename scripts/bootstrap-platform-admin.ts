import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

function requiredEnv(key: string) {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function assertProductionSafeUrl() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl.startsWith("postgresql://")) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string for platform admin bootstrap.");
  }
}

async function main() {
  assertProductionSafeUrl();

  const email = requiredEnv("PLATFORM_ADMIN_EMAIL").toLowerCase();
  const password = requiredEnv("PLATFORM_ADMIN_PASSWORD");
  const name = process.env.PLATFORM_ADMIN_NAME?.trim() || "Platform Admin";
  const shouldResetPassword = process.env.PLATFORM_ADMIN_RESET_PASSWORD === "true";

  if (password.length < 12) {
    throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: existing.name || name,
        platformRole: "platform_admin",
        status: "active",
        ...(shouldResetPassword ? { passwordHash: hashPassword(password) } : {}),
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: updated.id,
        actorLabel: "bootstrap",
        action: shouldResetPassword ? "bootstrap_platform_admin_reset_password" : "bootstrap_platform_admin",
        targetType: "User",
        targetId: updated.id,
        before: { email: existing.email, platformRole: existing.platformRole, status: existing.status },
        after: { email: updated.email, platformRole: updated.platformRole, status: updated.status },
      },
    });

    console.log(`Platform admin ensured for ${email}. Existing user was reused.`);
    return;
  }

  const created = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: hashPassword(password),
      platformRole: "platform_admin",
      status: "active",
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: created.id,
      actorLabel: "bootstrap",
      action: "bootstrap_platform_admin",
      targetType: "User",
      targetId: created.id,
      after: { email: created.email, platformRole: created.platformRole, status: created.status },
    },
  });

  console.log(`Platform admin created for ${email}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
