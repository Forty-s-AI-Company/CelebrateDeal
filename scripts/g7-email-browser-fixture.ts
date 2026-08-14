import { PrismaClient } from "@prisma/client";
import { protectEmailDeliveryPayload } from "../src/lib/email-delivery-pii";
import { hashPassword } from "../src/lib/password";

const db = new PrismaClient();
const mode = process.argv[2];
const runId = process.env.G707_BROWSER_RUN_ID ?? "";
const loginEmail = process.env.G707_SYNTHETIC_LOGIN ?? "";
const password = process.env.G707_SYNTHETIC_PASSWORD ?? "";

if (!/^[a-f0-9]{12}$/u.test(runId)) throw new Error("G7-07 browser run boundary rejected.");
if (!/^g707-browser-[a-f0-9]{12}@example\.test$/u.test(loginEmail)) throw new Error("G7-07 synthetic login rejected.");
if (password.length < 16 || password.length > 80) throw new Error("G7-07 synthetic password rejected.");

const vendorSlug = `g707-browser-${runId}`;

async function cleanup() {
  const vendor = await db.vendor.findUnique({ where: { slug: vendorSlug }, select: { id: true } });
  if (vendor) await db.vendor.delete({ where: { id: vendor.id } });
  await db.user.deleteMany({ where: { email: loginEmail } });
}

async function seed() {
  await cleanup();
  const vendor = await db.vendor.create({
    data: {
      name: "G7-07 合成商家",
      slug: vendorSlug,
      email: `g707-vendor-${runId}@example.test`,
      passwordHash: "synthetic-vendor-only",
      tracking: { create: {} },
    },
  });
  await db.user.create({
    data: {
      email: loginEmail,
      name: "G7-07 Browser Owner",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: {
        create: {
          vendorId: vendor.id,
          role: "owner",
          status: "active",
        },
      },
    },
  });
  const template = await db.messageTemplate.create({
    data: {
      vendorId: vendor.id,
      name: "G7-07 報名成功通知",
      channel: "email",
      trigger: "registration_confirmed",
      subject: "{{name}}，報名成功",
      body: "我們已收到你的報名。\n{{unsubscribe_url}}",
      isActive: true,
    },
  });

  for (const [index, status] of ["queued", "failed", "suppressed"].entries()) {
    const deliveryId = `g707_delivery_${runId}_${index}`;
    const protectedRecipient = protectEmailDeliveryPayload({
      recipientEmail: `browser-lead-${index}@example.test`,
      subject: "報名成功",
      body: "G7-07 合成通知內容",
    }, {
      vendorId: vendor.id,
      deliveryId,
    });
    await db.emailDelivery.create({
      data: {
        id: deliveryId,
        vendorId: vendor.id,
        sourceTemplateId: template.id,
        trigger: "registration_confirmed",
        ...protectedRecipient,
        idempotencyKey: `g707-browser/${runId}/${index}`,
        status,
        attemptCount: status === "failed" ? 2 : 0,
        maxAttempts: 5,
        nextAttemptAt: status === "queued" || status === "failed" ? new Date(Date.now() + 15 * 60_000) : null,
        lastErrorCode: status === "failed" ? "network" : status === "suppressed" ? "recipient_suppressed" : null,
      },
    });
  }
}

async function main() {
  try {
    if (mode === "seed") await seed();
    else if (mode === "cleanup") await cleanup();
    else throw new Error("Expected seed or cleanup mode.");
    process.stdout.write(JSON.stringify({ ok: true, mode, synthetic: true }));
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  // Fixture errors are intentionally value-free; credentials and DB URLs are
  // supplied by the bounded runner and never echoed here.
  process.stderr.write(error instanceof Error ? error.message : "G7-07 fixture failed.");
  process.exitCode = 1;
});
