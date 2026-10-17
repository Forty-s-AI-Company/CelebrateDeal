// Fixed loopback environment; only locally generated synthetic credentials.
const { PrismaClient } = require('@prisma/client');
const { chromium } = require('@playwright/test');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
process.env.CSRF_SECRET = 'wp10-synthetic-only-encryption-seed-20261011';
const { hashPasswordAsync } = require(path.join(process.cwd(), 'src/lib/password.ts'));
const { generateTotpSecret, encryptMfaSecret, totpCodeForTimestamp } = require(path.join(process.cwd(), 'src/lib/mfa.ts'));
const base = 'http://127.0.0.1:31025';
const db = new PrismaClient({ datasourceUrl: 'postgresql://postgres@127.0.0.1:64505/celebratedeal_ci?schema=public' });
const report = { status: 'IN_PROGRESS', results: [], fixtureDeactivated: false };
const save = () => fs.writeFileSync(path.join(__dirname, 'admin-mfa-result.json'), JSON.stringify(report, null, 2));
(async () => {
  let user;
  let browser;
  try {
    const password = randomBytes(24).toString('base64url');
    const email = `wp10-${randomBytes(6).toString('hex')}@audit.invalid`;
    user = await db.user.create({ data: { email, name: 'WP10 synthetic guard matrix', platformRole: 'platform_admin', passwordHash: await hashPasswordAsync(password) } });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${base}/login`);
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await page.waitForURL('**/mfa/setup?**');
    for (const requestedPath of ['/admin/billing/dashboard', '/admin/support-cases', '/admin/billing/payouts']) {
      await page.goto(`${base}${requestedPath}`);
      await page.waitForURL('**/mfa/setup?**');
      report.results.push({ state: 'unenrolled', requestedPath, finalPath: new URL(page.url()).pathname }); save();
    }
    await page.getByRole('button', { name: '開始建立 TOTP', exact: true }).click();
    await page.getByText('使用驗證器 App 掃描 QR Code', { exact: true }).waitFor();
    report.results.push({ state: 'enrollment-start', result: 'reachable-without-loop' }); save();
    // This fixture supplies a valid factor without reading the browser's setup secret.
    // Verification below uses the real TOTP action, not a preverified session.
    const secret = generateTotpSecret();
    await db.userMfaFactor.create({ data: { userId: user.id, factorType: 'totp', label: 'Synthetic matrix factor', secretEncrypted: encryptMfaSecret(secret) } });
    await page.goto(`${base}/admin/billing/dashboard`);
    await page.waitForURL('**/mfa/verify?**');
    report.results.push({ state: 'enrolled-unverified', finalPath: new URL(page.url()).pathname }); save();
    await page.locator('input[name=code]').fill(totpCodeForTimestamp(secret));
    await page.getByRole('button', { name: '確認並繼續', exact: true }).click();
    await page.waitForURL('**/admin/billing/dashboard');
    await page.locator('aside').waitFor({ state: 'visible' });
    const verified = await db.userSession.count({ where: { userId: user.id, revokedAt: null, mfaVerifiedAt: { not: null } } });
    if (verified !== 1) throw new Error('VERIFICATION_NOT_PERSISTED');
    report.results.push({ state: 'enrolled-verified', finalPath: new URL(page.url()).pathname, verificationPersisted: true }); save();
    await db.user.update({ where: { id: user.id }, data: { platformRole: 'none' } });
    await page.goto(`${base}/admin/billing/dashboard`);
    await page.waitForURL(url => !url.pathname.startsWith('/admin/'));
    report.results.push({ state: 'non-admin', platformAccessDenied: true });
    report.status = 'PASS';
  } catch (error) {
    report.status = 'FAIL'; report.failure = error.name === 'TimeoutError' ? 'TIMEOUT' : 'CHECK_FAILED'; process.exitCode = 1;
  } finally {
    if (user) {
      await db.userSession.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
      await db.user.update({ where: { id: user.id }, data: { status: 'inactive' } });
      report.fixtureDeactivated = true;
    }
    save(); if (browser) await browser.close(); await db.$disconnect();
  }
})().catch(async () => { report.status = 'FAIL'; save(); await db.$disconnect(); process.exitCode = 1; });
