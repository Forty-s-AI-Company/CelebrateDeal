import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { assertLocalTestDatabase } from "../../scripts/local-database-safety";
import { hashPassword } from "../../src/lib/password";
import { navigateAndAssertDirectUrlGuard } from "./helpers/direct-url-guard";

// This journey may mutate only its disposable, loopback synthetic database.
assertLocalTestDatabase("DATABASE_URL", process.env.DATABASE_URL);
const db = new PrismaClient();
const password = "SyntheticVideoJourney123!";

test("actual video create/edit/reload retains data and rejects foreign tenant read/write", async ({ browser }) => {
  test.setTimeout(180_000);
  const key = randomUUID();
  const vendors: string[] = [];
  const users: string[] = [];
  const contexts = [await browser.newContext(), await browser.newContext()];
  const login = async (page: Page, email: string) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  };
  try {
    for (const side of ["owner", "foreign"]) {
      const email = `${side}-${key}@synthetic-video.test`;
      const vendor = await db.vendor.create({ data: { name: `Synthetic ${side}`, slug: `${side}-${key}`,
        email, passwordHash: hashPassword(password), tracking: { create: {} } } });
      vendors.push(vendor.id);
      const user = await db.user.create({ data: { email, name: `Synthetic ${side}`,
        status: "active", passwordHash: hashPassword(password),
        memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
      users.push(user.id);
    }
    const ownerVendorId = vendors[0];
    const foreignVendorId = vendors[1];
    const ownerContext = contexts[0];
    const foreignContext = contexts[1];
    if (!ownerVendorId || !foreignVendorId || !ownerContext || !foreignContext) throw new Error("Synthetic fixture incomplete");
    const owner = await ownerContext.newPage();
    await login(owner, `owner-${key}@synthetic-video.test`);
    await owner.goto("/videos/new");
    await owner.getByLabel("影片名稱", { exact: true }).fill(`Synthetic video ${key}`);
    await owner.getByRole("textbox", { name: "影片描述", exact: true }).fill("Synthetic persistent description");
    await owner.getByText("進階：使用既有外部影片 URL", { exact: true }).click();
    // No upload/payment/mail provider is called; this proves the real supported URL form.
    await owner.getByLabel("影片 URL", { exact: true }).fill("https://media.example.test/synthetic-video.mp4");
    const videoForm = owner.locator("form").filter({ has: owner.getByLabel("影片名稱", { exact: true }) });
    await expect(videoForm.locator(':scope > input[name="_csrf"]')).not.toHaveValue("");
    await owner.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(owner).toHaveURL(/\/videos(?:\?.*)?$/);
    const video = await db.video.findFirstOrThrow({ where: { vendorId: ownerVendorId, title: `Synthetic video ${key}` } });
    expect(video.description).toBe("Synthetic persistent description");
    expect(video.sourceType).toBe("url");
    await owner.goto(`/videos/${video.id}/edit`);
    await owner.getByLabel("影片名稱", { exact: true }).fill(`Updated synthetic video ${key}`);
    await owner.getByRole("textbox", { name: "影片描述", exact: true }).fill("Updated persistent description");
    await owner.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(owner).toHaveURL(/\/videos(?:\?.*)?$/);
    await owner.goto(`/videos/${video.id}/edit`);
    await owner.reload();
    await expect(owner.getByLabel("影片名稱", { exact: true })).toHaveValue(`Updated synthetic video ${key}`);
    await expect(owner.getByRole("textbox", { name: "影片描述", exact: true })).toHaveValue("Updated persistent description");
    const before = await db.video.findUniqueOrThrow({ where: { id: video.id } });
    const foreignVideo = await db.video.create({ data: { vendorId: foreignVendorId, title: "Foreign synthetic video",
      sourceType: "url", status: "ready", videoUrl: "https://media.example.test/foreign.mp4" } });
    const foreign = await foreignContext.newPage();
    await login(foreign, `foreign-${key}@synthetic-video.test`);
    await navigateAndAssertDirectUrlGuard({ page: foreign, path: `/videos/${video.id}/edit`,
      transport: { kind: "streaming-not-found", status: 200 }, finalStatus: 200,
      finalUrl: `/videos/${video.id}/edit`, routeIdentityCanaries: [video.id],
      documentCanaries: [before.title, before.description ?? "", before.videoUrl],
    });
    await expect(foreign.getByLabel("影片名稱", { exact: true })).toHaveCount(0);
    await expect(foreign.getByText(`Updated synthetic video ${key}`, { exact: true })).toHaveCount(0);
    await foreign.goto(`/videos/${foreignVideo.id}/edit`);
    // Forge an owned form's resource ID: the server action must still scope by vendor.
    await foreign.locator('input[name="id"]').evaluate((element, id) => { (element as HTMLInputElement).value = id; }, video.id);
    await foreign.getByLabel("影片名稱", { exact: true }).fill("Forbidden mutation");
    // A controlled hidden input may be restored during hydration. Forge the
    // actual submitted FormData so this tests the server boundary, not React state.
    await foreign.locator("form").filter({ has: foreign.getByLabel("影片名稱", { exact: true }) })
      .evaluate((element, id) => {
        (element as HTMLFormElement).addEventListener("formdata", event => { event.formData.set("id", id); });
      }, video.id);
    await foreign.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(foreign).toHaveURL(/error=not_found/);
    expect(await db.video.findUniqueOrThrow({ where: { id: video.id } })).toEqual(before);
    expect(await db.video.count({ where: { vendorId: foreignVendorId, title: "Forbidden mutation" } })).toBe(0);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await db.vendor.deleteMany({ where: { id: { in: vendors } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
