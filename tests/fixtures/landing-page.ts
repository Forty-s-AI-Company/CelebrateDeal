import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

/**
 * TEST ONLY: the smallest project-scoped setup needed by the landing-page
 * browser journey. The returned password is used through the real login form;
 * no browser session is injected.
 */
export type LandingPageFixture = Awaited<ReturnType<typeof createLandingPageFixture>>;

export async function createLandingPageFixture(db: PrismaClient, runKey: string) {
  const suffix = runKey.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-18);
  const key = `test-only-landing-page-${suffix}`;
  const password = "TestOnlyLandingPage123!";
  const passwordHash = hashPassword(password);

  const vendor = await db.vendor.create({
    data: {
      name: "TEST ONLY Landing Page 商家",
      slug: `${key}-vendor`,
      email: `${key}@landing-page.test`,
      passwordHash,
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      timezone: "Asia/Taipei",
      tracking: { create: {} },
    },
  });
  const owner = await db.user.create({
    data: {
      name: "TEST ONLY Landing Page Owner",
      email: `owner-${suffix}@landing-page.test`,
      passwordHash,
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } },
    },
  });
  const project = await db.salesProject.create({
    data: {
      vendorId: vendor.id,
      name: "TEST ONLY Landing Page 專案",
      slug: `${key}-project`,
      mode: "live_course",
      primaryFlow: "live",
      status: "published",
      publishedAt: new Date("2030-01-01T00:00:00.000Z"),
    },
  });
  await db.userOnboardingPreference.create({
    data: { userId: owner.id, vendorId: vendor.id, selectedProjectId: project.id, selectedMode: "live_course" },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      projectId: project.id,
      name: "TEST ONLY Landing Page 報名表",
      slug: `${key}-form`,
      headline: "TEST ONLY Landing Page 報名",
      submitLabel: "TEST ONLY 完成報名",
      successMessage: "TEST ONLY 已收到報名",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const live = await db.live.create({
    data: {
      vendorId: vendor.id,
      projectId: project.id,
      formId: form.id,
      title: "TEST ONLY Landing Page 場次",
      slug: `${key}-live`,
      scheduledAt: new Date("2030-08-01T02:00:00.000Z"),
      status: "scheduled",
    },
  });

  return {
    password,
    owner: { id: owner.id, email: owner.email },
    vendor: { id: vendor.id },
    project: { id: project.id },
    form: { id: form.id, slug: form.slug, headline: form.headline, submitLabel: form.submitLabel, successMessage: form.successMessage },
    live: { id: live.id, title: live.title },
  };
}
