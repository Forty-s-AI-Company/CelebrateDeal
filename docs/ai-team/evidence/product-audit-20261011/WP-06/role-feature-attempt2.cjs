// Synthetic fixture only; restore membership and module flags even on failure.
const { PrismaClient } = require('@prisma/client');
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const base = 'http://127.0.0.1:31024';
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres@127.0.0.1:64505/celebratedeal_ci?schema=public' });
const modules = ['funnel_builder', 'live_webinar', 'affiliate_program', 'tax_remuneration', 'analytics_advanced', 'consultation_booking'];
const report = { status: 'IN_PROGRESS', profiles: [], restored: false };
const save = () => fs.writeFileSync(path.join(__dirname, 'role-feature-result.json'), JSON.stringify(report, null, 2));
(async () => {
  const member = await db.vendorMember.findFirstOrThrow({
    where: { user: { email: 'demo@celebratedeal.local' }, status: 'active' },
    select: { id: true, role: true, vendorId: true, vendor: { select: { enabledFeatureModules: true } } },
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    // One normal login avoids turning a navigation test into repeated login traffic.
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/login' || url.searchParams.has('error'));
    if (new URL(page.url()).pathname === '/login') throw new Error('LOGIN_BLOCKED');
    for (const role of ['owner', 'admin', 'accountant', 'support']) {
      for (const enabled of [true, false]) {
        await db.vendorMember.update({ where: { id: member.id }, data: { role } });
        await db.vendor.update({ where: { id: member.vendorId }, data: { enabledFeatureModules: enabled ? modules : [] } });
        const profile = { role, features: enabled ? 'all' : 'none', results: [] };
        report.profiles.push(profile); save();
        {
          await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
          await page.locator('aside').waitFor({ state: 'visible' });
          const home = new URL(page.url()).pathname;
          const hrefs = await page.locator('aside a[href^="/"]').evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('href')))]);
          if (!hrefs.length || hrefs.includes('/settings/line') !== (role === 'owner') ||
              hrefs.includes('/partner-pages') !== (enabled && role !== 'support')) throw new Error('NAV_MATRIX');
          for (const href of hrefs) {
            if (new URL(href, base).origin !== base) throw new Error('NONLOCAL');
            await page.goto(`${base}${home}`, { waitUntil: 'domcontentloaded' });
            await page.locator('aside').waitFor({ state: 'visible' });
            const link = page.locator(`aside a[href="${href}"]`).first();
            if (!await link.isVisible()) await page.getByRole('button', { name: '開啟工作區與帳號選單', exact: true }).click();
            await link.click();
            // Direct authenticated GET checks the destination including guard redirects.
            const response = await page.request.get(`${base}${href}`, { timeout: 30000 });
            const result = { href, finalPath: new URL(response.url()).pathname, status: response.status() };
            profile.results.push(result); save();
            if (result.status >= 400) throw new Error('HTTP_FAILURE');
          }
        }
      }
    }
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failure = error.name === 'TimeoutError' ? 'TIMEOUT' : 'CHECK_FAILED';
    process.exitCode = 1;
  } finally {
    await db.vendorMember.update({ where: { id: member.id }, data: { role: member.role } });
    await db.vendor.update({ where: { id: member.vendorId }, data: { enabledFeatureModules: member.vendor.enabledFeatureModules } });
    report.restored = true; save(); await context.close(); await browser.close(); await db.$disconnect();
  }
})().catch(async () => { report.status = 'FAIL'; save(); await db.$disconnect(); process.exitCode = 1; });
