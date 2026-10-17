// 固定 loopback disposable DB；只建立帶有本次識別碼的合成專案。
const { PrismaClient } = require('@prisma/client');
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres@127.0.0.1:64505/celebratedeal_ci?schema=public' });
const base = 'http://127.0.0.1:31024';
const report = { status: 'IN_PROGRESS', checks: [], restored: false };
(async () => {
  let browser, member, preference, originalModules;
  const slugs = [];
  try {
    member = await db.vendorMember.findFirstOrThrow({ where: { user: { email: 'demo@celebratedeal.local' }, status: 'active' }, select: { vendorId: true, userId: true } });
    originalModules = (await db.vendor.findUniqueOrThrow({ where: { id: member.vendorId }, select: { enabledFeatureModules: true } })).enabledFeatureModules;
    const key = { userId_vendorId: { userId: member.userId, vendorId: member.vendorId } };
    preference = await db.userOnboardingPreference.findUnique({ where: key, select: { selectedProjectId: true } });
    const baseline = ['funnel_builder', 'analytics_advanced'];
    await db.vendor.update({ where: { id: member.vendorId }, data: { enabledFeatureModules: baseline } });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    report.stage = 'login';
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.waitForURL('**/dashboard');
    for (let attempt = 0; attempt < 2; attempt++) {
      const slug = `audit-consultation-${Date.now()}-${attempt}`;
      slugs.push(slug);
      report.stage = 'project-form';
      await page.goto(`${base}/projects/new`);
      await page.getByLabel('專案名稱', { exact: true }).fill('合成諮詢測試');
      await page.getByLabel('網址代稱', { exact: true }).fill(slug);
      await page.locator('select[name="mode"]').selectOption('consulting');
      await page.locator('select[name="primaryFlow"]').selectOption('consultation');
      await page.locator('input[name="creationPath"][value="guided"]').check();
      await page.getByRole('button', { name: '建立專案', exact: true }).click();
      report.stage = 'project-redirect';
      await page.waitForURL('**/onboarding');
      const modules = (await db.vendor.findUniqueOrThrow({ where: { id: member.vendorId }, select: { enabledFeatureModules: true } })).enabledFeatureModules;
      assert.deepEqual(modules, [...baseline, 'consultation_booking']);
      report.stage = 'sidebar-entry';
      await page.locator('aside a[href="/consultations"]').first().waitFor({ state: 'visible' });
      const response = await page.goto(`${base}/consultations`);
      report.stage = 'consultation-response';
      assert.equal(response.status(), 200);
      assert.equal(new URL(page.url()).pathname, '/consultations');
      report.checks.push({ attempt, modulesPreserved: true, singleConsultationModule: true, sidebarEntry: true, consultationHttpStatus: 200 });
    }
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.failureType = error.name; process.exitCode = 1; }
  finally {
    try {
      if (member && originalModules) {
        await db.userOnboardingPreference.updateMany({ where: { userId: member.userId, vendorId: member.vendorId }, data: { selectedProjectId: preference?.selectedProjectId ?? null } });
        await db.salesProject.deleteMany({ where: { vendorId: member.vendorId, slug: { in: slugs } } });
        await db.vendor.update({ where: { id: member.vendorId }, data: { enabledFeatureModules: originalModules } });
        report.restored = true;
      }
    } catch { report.status = 'FAIL'; process.exitCode = 1; }
    fs.writeFileSync(path.join(__dirname, 'browser-result.json'), JSON.stringify(report, null, 2));
    if (browser) await browser.close();
    await db.$disconnect();
  }
})();
