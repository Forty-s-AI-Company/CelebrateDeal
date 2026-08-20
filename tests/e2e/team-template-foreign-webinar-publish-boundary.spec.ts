import { randomUUID } from "node:crypto";
import { expect, test, type Request } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";

const db = new PrismaClient();
const password = "Wp53SyntheticPassword!";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("template owner cannot publish a payload tampered with another member's webinar", async ({ page }, testInfo) => {
  const suffix = randomUUID().replace(/-/g, "");
  const canary = `wp53-${suffix}`;
  const vendor = await db.vendor.create({
    data: { name: `WP53 ${suffix}`, slug: `wp53-${suffix}`, email: `wp53-${suffix}@celebratedeal.test`, passwordHash: hashPassword(password), primaryColor: "#2563eb", ctaColor: "#f97316", tracking: { create: {} } },
  });
  const [actor, foreignUser] = await Promise.all([
    db.user.create({ data: { email: `wp53-a-${suffix}@celebratedeal.test`, name: "WP53 Member A", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } }),
    db.user.create({ data: { email: `wp53-b-${suffix}@celebratedeal.test`, name: "WP53 Member B", passwordHash: hashPassword(password), status: "active", memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } }),
  ]);
  try {
    const [memberA, memberB] = await Promise.all([
      db.vendorMember.findUniqueOrThrow({ where: { vendorId_userId: { vendorId: vendor.id, userId: actor.id } } }),
      db.vendorMember.findUniqueOrThrow({ where: { vendorId_userId: { vendorId: vendor.id, userId: foreignUser.id } } }),
    ]);
    const team = await db.salesTeam.create({ data: { vendorId: vendor.id, name: `WP53 Team ${suffix}`, slug: `wp53-team-${suffix}` } });
    const [teamA, teamB] = await Promise.all([
      db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: memberA.id, status: "ACTIVE" } }),
      db.teamMembership.create({ data: { vendorId: vendor.id, teamId: team.id, vendorMemberId: memberB.id, status: "ACTIVE" } }),
    ]);
    const [ownWebinar, foreignWebinar] = await Promise.all([
      db.live.create({ data: { vendorId: vendor.id, teamId: team.id, seminarOwnerMembershipId: teamA.id, title: `WP53 Own ${canary}`, slug: `wp53-own-${suffix}`, scheduledAt: new Date("2030-01-01T00:00:00.000Z") } }),
      db.live.create({ data: { vendorId: vendor.id, teamId: team.id, seminarOwnerMembershipId: teamB.id, title: `WP53 Foreign ${canary}`, slug: `wp53-foreign-${suffix}`, scheduledAt: new Date("2030-01-02T00:00:00.000Z") } }),
    ]);
    const template = await db.teamFunnelTemplate.create({ data: { vendorId: vendor.id, teamId: team.id, name: `WP53 Template ${canary}` } });
    const version = await db.teamFunnelTemplateVersion.create({ data: { vendorId: vendor.id, teamId: team.id, templateId: template.id, version: 1, contentOwnerMembershipId: teamA.id, createdByMemberId: memberA.id, headline: `WP53 Headline ${canary}`, ctaLabel: "了解更多" } });
    const source = await db.partnerFunnelPage.create({ data: { vendorId: vendor.id, teamId: team.id, templateVersionId: version.id, promoterMembershipId: teamA.id, contentOwnerMembershipId: teamA.id, liveId: ownWebinar.id, slug: `wp53-source-${suffix}`, headline: `WP53 Headline ${canary}`, ctaLabel: "了解更多" } });
    const snapshot = async () => ({ template: await db.teamFunnelTemplate.findUniqueOrThrow({ where: { id: template.id } }), versions: await db.teamFunnelTemplateVersion.findMany({ where: { templateId: template.id }, orderBy: { version: "asc" } }), page: await db.partnerFunnelPage.findUniqueOrThrow({ where: { id: source.id } }), lives: await db.live.findMany({ where: { id: { in: [ownWebinar.id, foreignWebinar.id] } }, orderBy: { id: "asc" } }) });
    const before = await snapshot();
    await page.goto("/login");
    await page.getByLabel("Email").fill(actor.email);
    await page.getByLabel("密碼").fill(password);
    await page.getByRole("button", { name: "登入" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const editPath = `/team-templates/${template.id}/edit`;
    const editResponse = await page.goto(editPath);
    expect(editResponse?.status()).toBe(200);
    await expect(page.getByLabel("綁定 webinar")).toContainText(ownWebinar.title);
    await expect(page.getByLabel("綁定 webinar")).not.toContainText(foreignWebinar.title);
    const webinarSelect = page.locator('select[name="webinarId"]');
    await expect(webinarSelect).toContainText(ownWebinar.title);
    await expect(webinarSelect).not.toContainText(foreignWebinar.title);
    const publishForm = page.locator('form:has(input[name="operation"][value="publish"])');
    await publishForm.evaluate((form, { id, title }) => {
      const publishFormElement = form as HTMLFormElement;
      form.addEventListener("submit", () => {
        const select = publishFormElement.querySelector<HTMLSelectElement>('select[name="webinarId"]');
        if (!select) throw new Error("missing webinar selector in publish form");
        select.add(new Option(title, id));
        select.value = id;
        const serializedWebinarId = new FormData(publishFormElement).get("webinarId");
        (publishFormElement as HTMLFormElement & { __wp53SerializedWebinarId?: FormDataEntryValue | null }).__wp53SerializedWebinarId = serializedWebinarId;
        if (serializedWebinarId !== id) throw new Error(`unexpected serialized webinarId: ${String(serializedWebinarId)}`);
      }, { capture: true, once: true });
    }, { id: foreignWebinar.id, title: foreignWebinar.title });
    page.once("dialog", (dialog) => dialog.accept());
    const responses: number[] = [];
    let publishRequestEvidence: { method: string; status: number | null; pathname: string; requestFailedReason: string | null } | null = null;
    const isPublishActionRequest = (request: Request) => {
      const url = new URL(request.url());
      return request.method() === "POST" && url.pathname === editPath && Boolean(request.headers()["next-action"]);
    };
    page.on("request", (request) => {
      if (!isPublishActionRequest(request)) return;
      publishRequestEvidence = { method: request.method(), status: null, pathname: new URL(request.url()).pathname, requestFailedReason: null };
    });
    page.on("response", (response) => {
      if (response.request().method() !== "POST" || !response.request().headers()["next-action"]) return;
      responses.push(response.status());
      if (isPublishActionRequest(response.request()) && publishRequestEvidence) publishRequestEvidence.status = response.status();
    });
    page.on("requestfailed", (request) => {
      if (isPublishActionRequest(request) && publishRequestEvidence) publishRequestEvidence.requestFailedReason = request.failure()?.errorText ?? "unknown";
    });
    const publishResponsePromise = page.waitForResponse((response) => isPublishActionRequest(response.request()));
    await page.getByRole("button", { name: "發布新版本" }).click();
    await expect.poll(() => publishForm.evaluate((form) => (
      (form as HTMLFormElement & { __wp53SerializedWebinarId?: FormDataEntryValue | null }).__wp53SerializedWebinarId ?? null
    ))).toBe(foreignWebinar.id);
    let publishResponse;
    try {
      publishResponse = await publishResponsePromise;
    } catch {
      const evidence = publishRequestEvidence ?? { method: "POST", status: null, pathname: editPath, requestFailedReason: "response-not-observed" };
      await testInfo.attach("wp53-publish-action-sanitized-evidence.json", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
      throw new Error(`RUNTIME_BLOCKED/HANG:WP53_PUBLISH_ACTION_RESPONSE_NOT_OBSERVED:${JSON.stringify(evidence)}`);
    }
    expect(publishResponse.status()).toBe(200);
    await testInfo.attach("wp53-publish-action-sanitized-evidence.json", {
      body: JSON.stringify(publishRequestEvidence ?? { method: "POST", status: publishResponse.status(), pathname: editPath, requestFailedReason: null }, null, 2),
      contentType: "application/json",
    });
    await expect(page.getByRole("alert").filter({ hasText: "你沒有管理這個團隊模板的權限，或該資源已不存在。" })).toHaveText("你沒有管理這個團隊模板的權限，或該資源已不存在。");
    expect(responses).toContain(200);
    await expect.poll(snapshot).toEqual(before);
  } finally {
    // These team-domain FKs deliberately use RESTRICT. Delete synthetic dependants
    // from leaves to roots so failed assertions cannot leave disposable rows behind.
    await db.partnerFunnelPage.deleteMany({ where: { vendorId: vendor.id } });
    await db.teamFunnelTemplateVersion.deleteMany({ where: { vendorId: vendor.id } });
    await db.teamFunnelTemplate.deleteMany({ where: { vendorId: vendor.id } });
    await db.live.deleteMany({ where: { vendorId: vendor.id } });
    await db.teamMembership.deleteMany({ where: { vendorId: vendor.id } });
    await db.vendor.deleteMany({ where: { id: vendor.id } });
    await db.user.deleteMany({ where: { id: { in: [actor.id, foreignUser.id] } } });
    await db.$disconnect();
  }
});
