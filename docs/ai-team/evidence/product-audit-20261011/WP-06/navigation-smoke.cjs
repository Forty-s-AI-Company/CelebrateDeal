// Run only against this Goal's loopback server and synthetic seeded database.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const base = 'http://127.0.0.1:31024';
const output = path.join(__dirname, 'navigation-smoke-result.json');
const results = [];
const save = (status, failure) => fs.writeFileSync(output, JSON.stringify({
  status, scope: 'synthetic owner sidebar and account menu; legacy redirect',
  results, failure, cookiesCaptured: false,
}, null, 2));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let current = 'login';
  try {
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.waitForURL('**/dashboard');
    await page.locator('aside').waitFor({ state: 'visible' });
    const hrefs = await page.locator('aside a[href^="/"]').evaluateAll(nodes =>
      [...new Set(nodes.map(node => node.getAttribute('href')))]);
    if (!hrefs.length) throw new Error('EMPTY_INVENTORY');
    save('IN_PROGRESS');
    for (const href of hrefs) {
      current = href;
      if (new URL(href, base).origin !== base) throw new Error('NONLOCAL_LINK');
      await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.locator('aside').waitFor({ state: 'visible' });
      const target = page.locator(`aside a[href="${href}"]`).first();
      if (!await target.isVisible()) {
        await page.getByRole('button', { name: '開啟工作區與帳號選單', exact: true }).click();
      }
      await target.click();
      // Background polling is unrelated to navigation completion.
      await page.waitForURL(url => url.pathname === href, { waitUntil: 'domcontentloaded' });
      const response = await page.request.get(`${base}${href}`, { timeout: 30000 });
      const status = response.status();
      results.push({ href, finalPath: new URL(response.url()).pathname, status });
      save('IN_PROGRESS');
      if (status >= 400) throw new Error('HTTP_FAILURE');
    }
    current = '/settings/commissions';
    const response = await page.goto(`${base}${current}`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/affiliates');
    if (!response || response.status() >= 400) throw new Error('REDIRECT_FAILURE');
    results.push({ href: current, finalPath: new URL(page.url()).pathname, status: response.status() });
    save('PASS');
  } catch (error) {
    // Only fixed paths and error categories are retained; no page content or credentials.
    save('FAIL', { href: current, category: error.name === 'TimeoutError' ? 'TIMEOUT' : 'CHECK_FAILED' });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(() => { save('FAIL', { category: 'BROWSER_START_FAILED' }); process.exitCode = 1; });
