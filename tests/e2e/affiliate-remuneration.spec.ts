import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/password";
import { appendCommissionLedgerEntry } from "../../src/lib/affiliate-commission-accounting";
import { reconcileAffiliatePendingPayout } from "../../src/lib/affiliate-payout-accounting";
import { CSRF_FIELD_NAME } from "../../src/lib/csrf-constants";
import { formatCurrency } from "../../src/lib/format";
test.use({ trace: "off", screenshot: "off", video: "off" });
test.setTimeout(180000);
test("owner sets fee; partner submits, receives approval, signs and exports; refund/revoke stay isolated", async ({ page, browser, baseURL }) => {
  const db = new PrismaClient(), suffix = randomUUID(), password = "SyntheticRemuneration!";
  const vendor = await db.vendor.create({ data: { name: "合成提領商家", slug: `remuneration-${suffix}`, email: `${suffix}@example.test`, passwordHash: hashPassword(password), tracking: { create: {} } } });
  const manager = await db.user.create({ data: { email: `owner-${suffix}@example.test`, name: "合成管理員", passwordHash: hashPassword(password), memberships: { create: { vendorId: vendor.id, role: "owner", status: "active" } } } });
  const partner = await db.user.create({ data: { email: `payee-${suffix}@example.test`, name: "合成收款夥伴", passwordHash: hashPassword(password), memberships: { create: { vendorId: vendor.id, role: "partner", status: "active" } } }, include: { memberships: true } });
  const other = await db.vendor.create({ data: { name: "合成外租戶", slug: `other-${suffix}`, email: `other-${suffix}@example.test`, passwordHash: hashPassword(password), tracking: { create: {} } } });
  const outsider = await db.user.create({ data: { email: `foreign-${suffix}@example.test`, name: "合成外部管理員", passwordHash: hashPassword(password), memberships: { create: { vendorId: other.id, role: "owner", status: "active" } } } });
  const affiliate = await db.affiliate.create({ data: { vendorId: vendor.id, name: "合成合作夥伴", code: `PAYEE-${suffix}` } });
  await db.affiliatePortalAccess.create({ data: { vendorId: vendor.id, affiliateId: affiliate.id, vendorMemberId: partner.memberships[0]!.id } });
  const payout = await db.affiliatePayout.create({ data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-10", finalAmountCents: 3_000_000 } });
  const commission = await db.affiliateCommission.create({ data: { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-10", status: "locked", deduplicationKey: randomUUID(), orderAmountCents: 30_000_000, commissionBaseAmountCents: 30_000_000, commissionRateBps: 1000, commissionAmountCents: 3_000_000 } });
  const event = { vendorId: vendor.id, affiliateCommissionId: commission.id, providerName: "synthetic", eventIdentity: randomUUID(), occurredAt: new Date() };
  await db.$transaction(tx => appendCommissionLedgerEntry(tx, { ...event, entryType: "opening_balance", amountCents: 3_000_000 }));
  const partnerContext = await browser.newContext(), foreignContext = await browser.newContext();
  const partnerPage = await partnerContext.newPage(), foreignPage = await foreignContext.newPage();
  const memberPath = `/affiliate-portal/${vendor.slug}/${affiliate.id}/remuneration`, managerPath = `/affiliates/${affiliate.id}/remuneration`;
  async function login(target: typeof page, email: string) {
    await target.goto(`${baseURL}/login`); await target.getByLabel("Email").fill(email); await target.getByLabel("密碼").fill(password); await target.getByRole("button", { name: "登入", exact: true }).click(); await expect(target).toHaveURL(/\/dashboard$/u);
  }
  // Synthetic CSRF stays inside the browser; only HTTP status leaves evaluate.
  async function exportStatus(target: typeof page, endpoint: string) {
    return target.evaluate(async ({ endpoint, field }) => {
      const token = document.querySelector<HTMLInputElement>(`input[name="${field}"]`)?.value ?? "";
      return (await fetch(endpoint, { method: "POST", body: new URLSearchParams({ [field]: token }) })).status;
    }, { endpoint, field: CSRF_FIELD_NAME });
  }
  try {
    for (const context of [page.context(), partnerContext, foreignContext]) await context.route(url => url.origin !== new URL(baseURL!).origin, route => route.abort());
    await login(page, manager.email); await page.goto("/affiliates"); await page.getByRole("link", { name: "提領費用", exact: true }).click();
    await page.getByLabel("每筆轉帳費用", { exact: false }).fill("1500"); await page.getByLabel("啟用提領報價與匯出", { exact: true }).check(); await page.getByRole("button", { name: "儲存提領政策", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("提領政策已儲存。");
    expect(await db.merchantAffiliatePayoutPolicy.findUniqueOrThrow({ where: { vendorId: vendor.id } })).toMatchObject({ revision: 1, bankFeeCents: 1500, enabled: true });
    await login(partnerPage, partner.email); await partnerPage.goto(`/affiliate-portal/${vendor.slug}/${affiliate.id}`); await partnerPage.getByRole("link", { name: "收款資料與佣金提領", exact: true }).click();
    await partnerPage.getByLabel("戶名", { exact: true }).fill("Synthetic Payee"); await partnerPage.getByLabel("銀行代碼", { exact: true }).fill("999"); await partnerPage.getByLabel("收款帳號", { exact: true }).fill("123456789012"); await partnerPage.getByLabel("稅籍識別碼", { exact: true }).fill("SYNTHETIC123");
    await partnerPage.getByRole("button", { name: "提交收款資料", exact: true }).click(); await expect(partnerPage.getByRole("status")).toHaveText("資料已儲存。");
    const profile = await db.affiliatePayeeProfile.findUniqueOrThrow({ where: { vendorId_affiliateId: { vendorId: vendor.id, affiliateId: affiliate.id } } });
    expect(profile).toMatchObject({ revision: 1, approvedRevision: null }); expect(profile.bankEncrypted).not.toContain("123456789012"); expect(profile.taxIdentityEncrypted).not.toContain("SYNTHETIC123");
    await page.goto(`/affiliates/${affiliate.id}`); await page.getByRole("link", { name: "收款核准與提領匯出", exact: true }).click(); await page.getByLabel("我已核對本版本分類與相關憑證。", { exact: true }).check(); await page.getByRole("button", { name: "核准此收款資料版本", exact: true }).click(); await expect(page.getByText("此版本已核准。", { exact: true })).toBeVisible();
    await partnerPage.reload(); await partnerPage.getByRole("button", { name: "取得最新提領報價", exact: true }).click(); await expect(partnerPage.getByLabel("提領報價明細")).toContainText(formatCurrency(2_635_200));
    await partnerPage.getByLabel("我確認本次佣金、扣繳、補充保費、費用與實領金額，並同意簽署。", { exact: true }).check(); await partnerPage.getByRole("button", { name: "簽署本次提領", exact: true }).click(); await expect(partnerPage.getByText("簽署狀態：已簽署", { exact: true })).toBeVisible(); await partnerPage.reload(); await expect(partnerPage.getByText("簽署狀態：已簽署", { exact: true })).toBeVisible();
    const snapshot = await db.affiliateRemunerationSnapshot.findFirstOrThrow({ where: { vendorId: vendor.id, affiliateId: affiliate.id, payoutId: payout.id } }); expect(snapshot.signedByUserId).toBe(partner.id);
    const endpoint = `/api/affiliates/${affiliate.id}/remuneration/${snapshot.id}/export`;
    await page.reload(); expect(await page.evaluate(async ({ endpoint, field }) => (await fetch(endpoint, { method: "POST", body: new URLSearchParams({ [field]: "synthetic-invalid" }) })).status, { endpoint, field: CSRF_FIELD_NAME })).toBe(403); expect(await db.affiliateRemunerationExport.count({ where: { snapshotId: snapshot.id } })).toBe(0);
    await login(foreignPage, outsider.email); await foreignPage.goto("/affiliates/payout-policy"); await foreignPage.getByLabel("每筆轉帳費用", { exact: false }).fill("1500"); await foreignPage.getByLabel("啟用提領報價與匯出", { exact: true }).check(); await foreignPage.getByRole("button", { name: "儲存提領政策", exact: true }).click(); await expect(foreignPage.getByRole("status")).toHaveText("提領政策已儲存。"); expect(await exportStatus(foreignPage, endpoint)).toBe(409); await foreignPage.goto(managerPath); await expect(foreignPage.getByRole("button", { name: "下載私有提領 CSV", exact: true })).toHaveCount(0);
    const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "下載私有提領 CSV", exact: true }).click(); const download = await downloadPromise, file = await download.path(); expect(file).not.toBeNull(); const csv = fs.readFileSync(file!, "utf8"); expect(csv).toContain("2635200"); expect(csv).toContain("SYNTHETIC123"); expect(csv).toContain(snapshot.id);
    await page.reload(); expect(await exportStatus(page, endpoint)).toBe(200); expect(await db.affiliateRemunerationExport.count({ where: { snapshotId: snapshot.id } })).toBe(1); expect(await db.affiliatePayout.findUniqueOrThrow({ where: { id: payout.id } })).toMatchObject({ status: "pending", paidAt: null });
    const refund = { ...event, eventIdentity: randomUUID(), entryType: "refund" as const, amountCents: -500_000 };
    await db.$transaction(async tx => { await appendCommissionLedgerEntry(tx, refund); await appendCommissionLedgerEntry(tx, refund); await reconcileAffiliatePendingPayout(tx, { vendorId: vendor.id, affiliateId: affiliate.id, monthKey: "2026-10" }); });
    expect(await exportStatus(page, endpoint)).toBe(409); await partnerPage.goto(memberPath); await partnerPage.getByRole("button", { name: "取得最新提領報價", exact: true }).click(); await expect(partnerPage.getByLabel("提領報價明細")).toContainText(formatCurrency(2_500_000));
    await db.affiliatePortalAccess.update({ where: { vendorId_affiliateId: { vendorId: vendor.id, affiliateId: affiliate.id } }, data: { active: false } }); await partnerPage.reload(); await expect(partnerPage.getByRole("button", { name: "提交收款資料", exact: true })).toHaveCount(0); expect(await exportStatus(page, endpoint)).toBe(409);
  } finally { await partnerContext.close(); await foreignContext.close(); await db.$disconnect(); }
  // Owned disposable database removes immutable financial fixtures as a whole.
});
