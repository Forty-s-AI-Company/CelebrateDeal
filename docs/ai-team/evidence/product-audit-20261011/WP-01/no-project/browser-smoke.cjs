const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch();
  const report = { status: 'IN_PROGRESS', results: [] };
  try {
    const page = await browser.newPage();
    const base = 'http://127.0.0.1:31024';
    await page.goto(`${base}/login`);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.waitForURL('**/dashboard');
    for (const [label, destination] of [['建立專案', '/projects/new'], ['選擇既有專案', '/projects']]) {
      await page.goto(`${base}/landing-pages/new`);
      await page.getByRole('heading', { name: '尚未選擇專案', exact: true }).waitFor();
      await page.getByRole('link', { name: label, exact: true }).click();
      await page.waitForURL(url => url.pathname === destination);
      const response = await page.request.get(`${base}${destination}`);
      if (response.status() !== 200) throw new Error('DESTINATION_UNAVAILABLE');
      report.results.push({ label, destination, status: response.status() });
    }
    report.status = 'PASS';
  } catch {
    report.status = 'FAIL'; process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(__dirname, 'browser-result.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})();
