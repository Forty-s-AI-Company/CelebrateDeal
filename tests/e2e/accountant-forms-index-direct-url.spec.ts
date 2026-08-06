import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp64SyntheticPassword!";

// This negative authorization proof must not retain a synthetic session.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(90_000);

test("active accountant is denied the forms index before lead relationships are queried", async ({ page }) => {
  const suffix = randomUUID().replace(/-/g, "");
  const tag = `wp64-${suffix}`;
  const vendor = await db.vendor.create({
    data: {
      name: `WP64 Vendor ${suffix}`,
      slug: tag,
      email: `${tag}@celebratedeal.test`,
      passwordHash: hashPassword(password),
      primaryColor: "#2563eb",
      ctaColor: "#f97316",
      tracking: {
        create: {
          facebookPixelId: `WP64-FB-${suffix}`,
          tiktokPixelId: `WP64-TT-${suffix}`,
          googleTagManagerId: `WP64-GTM-${suffix}`,
        },
      },
    },
  });
  const user = await db.user.create({
    data: {
      email: `accountant-${tag}@celebratedeal.test`,
      name: "WP64 Active Accountant",
      passwordHash: hashPassword(password),
      status: "active",
      memberships: { create: { vendorId: vendor.id, role: "accountant", status: "active" } },
    },
  });
  const form = await db.registrationForm.create({
    data: {
      vendorId: vendor.id,
      name: `WP64 Form ${suffix}`,
      slug: `wp64-form-${suffix}`,
      headline: `WP64 Headline ${suffix}`,
      description: `WP64 form description ${suffix}`,
      submitLabel: `WP64 Submit ${suffix}`,
      successMessage: `WP64 Success ${suffix}`,
      fields: [
        { key: `wp64_name_${suffix}`, label: `WP64 Name Label ${suffix}`, type: "text", required: true },
        { key: `wp64_email_${suffix}`, label: `WP64 Email Label ${suffix}`, type: "email", required: true },
      ],
      isActive: true,
    },
  });
  const submissions = await Promise.all([
    db.formSubmission.create({
      data: {
        formId: form.id,
        name: `WP64 Lead A ${suffix}`,
        email: `lead-a-${tag}@example.test`,
        phone: `0900${suffix.slice(0, 6)}`,
        answers: { canary: `wp64-answer-a-${suffix}` },
        source: `WP64 source A ${suffix}`,
      },
    }),
    db.formSubmission.create({
      data: {
        formId: form.id,
        name: `WP64 Lead B ${suffix}`,
        email: `lead-b-${tag}@example.test`,
        phone: `0911${suffix.slice(0, 6)}`,
        answers: { canary: `wp64-answer-b-${suffix}` },
        source: `WP64 source B ${suffix}`,
      },
    }),
  ]);
  const [tracking, membership] = await Promise.all([
    db.trackingSetting.findUniqueOrThrow({ where: { vendorId: vendor.id } }),
    db.vendorMember.findUniqueOrThrow({
      where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    }),
  ]);

  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const snapshot = async () => ({
      vendor: await db.vendor.findUniqueOrThrow({ where: { id: vendor.id } }),
      vendorCount: await db.vendor.count(),
      tracking: await db.trackingSetting.findUniqueOrThrow({ where: { id: tracking.id } }),
      trackingCount: await db.trackingSetting.count(),
      trackingVendorCount: await db.trackingSetting.count({ where: { vendorId: vendor.id } }),
      user: await db.user.findUniqueOrThrow({ where: { id: user.id } }),
      userCount: await db.user.count(),
      membership: await db.vendorMember.findUniqueOrThrow({ where: { id: membership.id } }),
      membershipVendorCount: await db.vendorMember.count({ where: { vendorId: vendor.id } }),
      form: await db.registrationForm.findUniqueOrThrow({ where: { id: form.id } }),
      formCount: await db.registrationForm.count(),
      formVendorCount: await db.registrationForm.count({ where: { vendorId: vendor.id } }),
      submissions: await db.formSubmission.findMany({
        where: { formId: form.id },
        orderBy: { id: "asc" },
      }),
      submissionCount: await db.formSubmission.count(),
      submissionFormCount: await db.formSubmission.count({ where: { formId: form.id } }),
      submissionVendorRelationCount: await db.formSubmission.count({
        where: { form: { vendorId: vendor.id } },
      }),
      relations: {
        formVendorId: (await db.registrationForm.findUniqueOrThrow({ where: { id: form.id } })).vendorId,
        submissionFormIds: (await db.formSubmission.findMany({
          where: { formId: form.id },
          orderBy: { id: "asc" },
          select: { formId: true, liveId: true },
        })),
      },
    });
    const before = await snapshot();
    const formFields = form.fields as Array<Record<string, unknown>>;
    const canaries = [
      form.id,
      form.name,
      form.slug,
      form.headline,
      form.description,
      form.submitLabel,
      form.successMessage,
      ...formFields.flatMap((field) => [field.key, field.label]),
      ...submissions.flatMap((submission) => [
        submission.id,
        submission.name,
        submission.email,
        submission.phone,
        submission.source,
        (submission.answers as { canary?: string } | null)?.canary,
      ]),
    ].filter((value): value is string => typeof value === "string" && value.length > 0);

    const posts: string[] = [];
    const external: string[] = [];
    const path = "/forms";
    const intercepted: {
      current?: { status: number; location: string | undefined; body: string };
    } = {};
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST") posts.push(url.pathname);
      if (!new Set(["127.0.0.1", "localhost"]).has(url.hostname)) external.push(request.url());
    });
    await page.route("**/forms", async (route) => {
      if (new URL(route.request().url()).pathname !== path) {
        await route.continue();
        return;
      }
      const response = await route.fetch({ maxRedirects: 0 });
      intercepted.current = {
        status: response.status(),
        location: response.headers().location,
        body: await response.text(),
      };
      await route.fulfill({ response });
    });

    const rawRedirect = page.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.status() === 307,
    );
    const finalResponse = await page.goto(path);
    const redirectResponse = await rawRedirect;

    expect(redirectResponse.status()).toBe(307);
    expect(redirectResponse.headers().location).toBe("/dashboard?error=insufficient_role");
    expect(intercepted.current).toBeDefined();
    expect(intercepted.current?.status).toBe(307);
    expect(intercepted.current?.location).toBe("/dashboard?error=insufficient_role");
    for (const canary of canaries) expect(intercepted.current?.body).not.toContain(canary);
    expect(intercepted.current?.body).not.toContain("2 名單");

    expect(finalResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\?error=insufficient_role$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "報名表管理", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "新增表單", exact: true })).toHaveCount(0);
    await expect(page.getByText(form.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(`/form/${form.slug}`, { exact: true })).toHaveCount(0);
    await expect(page.getByText("2 名單", { exact: true })).toHaveCount(0);
    await expect(page.locator(`a[href="/forms/${form.id}/edit"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/forms/${form.id}/submissions"]`)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "主要導覽" }).locator('a[href="/forms"]')).toHaveCount(0);
    for (const canary of canaries) {
      await expect(page.getByText(canary, { exact: true })).toHaveCount(0);
    }

    expect(posts).toEqual([]);
    expect(external).toEqual([]);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
});
