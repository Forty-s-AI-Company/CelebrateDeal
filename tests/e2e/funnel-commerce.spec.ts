import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createFunnelCommerceFixture } from "../fixtures/funnel-commerce";

const db = new PrismaClient();
const runKey = randomUUID();
let fixture: Awaited<ReturnType<typeof createFunnelCommerceFixture>>;
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeAll(async () => { fixture = await createFunnelCommerceFixture(db, runKey); });
test.afterAll(async () => { await db.$disconnect(); });

test("商品綁定、可信價格與兩步驟結帳（付款 transport mock，非 sandbox）", async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin;
  expect(["127.0.0.1", "localhost"]).toContain(new URL(origin).hostname);
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("console", message => {
    if (message.text().startsWith("QA_REACT_DIAGNOSTIC ")) console.log(message.text());
  });
  page.on("requestfailed", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/_next/static/")) console.log(`QA_DIAGNOSTIC ${JSON.stringify({ asset: url.pathname, failure: request.failure()?.errorText })}`);
  });
  page.on("response", response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/_next/static/") && response.status() >= 400) console.log(`QA_DIAGNOSTIC ${JSON.stringify({ asset: url.pathname, status: response.status() })}`);
  });
  await page.addInitScript(() => {
    window.addEventListener("error", event => {
      const digest: unknown = (event.error as { digest?: unknown } | undefined)?.digest;
      const code = typeof digest === "string" ? digest.split(";")[0] : "";
      const safeDigest = code === "CSS failed to load" || /^[A-Za-z0-9_@.:-]{0,80}$/u.test(code) ? code : typeof digest;
      console.info(`QA_REACT_DIAGNOSTIC ${JSON.stringify({ digest: safeDigest, readyState: document.readyState })}`);
    });
  });
  page.on("pageerror", error => {
    // Keep error categories and the synthetic page path, never full URLs,
    // request payloads, headers or browser session storage.
    const category = error.message.match(/Minified React error #\d+|Cannot read properties of [^\n]+|[\w$]+ is not defined|Loading chunk \d+ failed|Unexpected [^\n]+/u)?.[0] ?? error.name;
    errors.push(`${new URL(page.url()).pathname}: ${category.replace(/https?:\/\/\S+/gu, "[URL]").slice(0, 160)}`);
  });
  // No outbound traffic. The legacy editor stylesheet imports this optional
  // font: provide inert local CSS so blocking it cannot break React streaming.
  await page.context().route(url => url.origin !== origin, route => route.request().url() === "https://rsms.me/inter/inter.css"
    ? route.fulfill({ status: 200, contentType: "text/css", body: "/* TEST ONLY: offline system-font fallback. */" })
    : route.abort("blockedbyclient"));
  const slug = `test-only-commerce-${runKey.replaceAll("-", "").slice(-12)}`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(fixture.owner.email);
  await page.getByLabel("密碼").fill(fixture.password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/u);
  await expect(page.getByRole("heading", { name: "營運 Dashboard", exact: true })).toBeVisible();
  await page.goto("/landing-pages/new");
  await expect(page.getByRole("heading", { name: "建立新的 Funnel" })).toBeVisible().catch(async (error: unknown) => {
    // Only structural diagnostics; never serialize session storage or request headers.
    const ancestors = await page.getByLabel("名稱 *").evaluate((element) => {
      const result: Array<{ tag: string; hidden: boolean; display: string; visibility: string }> = [];
      for (let node: Element | null = element; node; node = node.parentElement) result.push({ tag: node.tagName, hidden: node.hasAttribute("hidden"), display: getComputedStyle(node).display, visibility: getComputedStyle(node).visibility });
      return result;
    });
    console.log(`QA_DIAGNOSTIC ${JSON.stringify({ pageErrors: errors, ancestors })}`);
    throw error;
  });
  // App Router may retain a hidden streaming fragment; interact with the
  // accessible controls, while preserving strict uniqueness for visible UI.
  await page.getByRole("textbox", { name: "名稱 *", exact: true }).fill("TEST ONLY Commerce Funnel");
  await page.getByRole("textbox", { name: /^Funnel 網址 \*/u }).fill(slug);
  await page.getByRole("button", { name: /銷售商品或服務/u }).click();
  await page.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page).toHaveURL(/\/landing-pages\/[^/?]+\/operations$/u);
  const funnelId = new URL(page.url()).pathname.split("/").at(-2)!;
  await page.getByRole("button", { name: "套用模板", exact: true }).first().click();
  await expect(page.getByRole("status")).toContainText("模板已套用");
  await page.getByRole("button", { name: "Edit Page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${funnelId}\\?step=`, "u"));
  await page.getByRole("button", { name: "頁面設定", exact: true }).click();
  const productSelect = page.getByRole("combobox", { name: /^本步驟商品/u });
  await expect(productSelect).toBeVisible();
  await expect(productSelect.locator(`option[value="${fixture.unlinked.id}"]`)).toHaveCount(0);
  await productSelect.selectOption(fixture.product.id);
  await page.getByRole("combobox", { name: /^加購商品（選填）/u }).selectOption(fixture.bump.id);
  await page.getByRole("combobox", { name: /^結帳版面/u }).selectOption("two_step");
  const agreement = "TEST ONLY 我同意此商品交付條款";
  await page.getByRole("textbox", { name: "額外同意條款（選填）", exact: true }).fill(agreement);
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/landing-pages/${funnelId}\\?step=`, "u"));
  await expect(page.getByRole("button", { name: "發布已儲存草稿", exact: true })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "頁面設定", exact: true }).click();
  await expect(productSelect).toHaveValue(fixture.product.id);
  await expect(page.getByRole("combobox", { name: /^加購商品（選填）/u })).toHaveValue(fixture.bump.id);
  await expect(page.getByRole("combobox", { name: /^結帳版面/u })).toHaveValue("two_step");
  await expect(page.getByRole("textbox", { name: "額外同意條款（選填）", exact: true })).toHaveValue(agreement);
  await page.getByRole("button", { name: "發布已儲存草稿", exact: true }).click();
  await expect(page.getByRole("link", { name: /查看公開頁/u })).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator('[data-render-mode="preview"]:visible')).toBeVisible();
  await expect(page.getByRole("button", { name: "前往安全結帳（預覽不收款）", exact: true })).toBeDisabled();
  await expect(page.locator('[data-funnel-renderer] a[href$="/checkout"]')).toHaveCount(0);
  await page.goto(`/lp/${slug}`);
  const checkoutLink = page.getByRole("link", { name: "前往安全結帳", exact: true });
  await expect(checkoutLink).toHaveAttribute("href", new RegExp(`^/lp/${slug}/[^/]+/checkout$`, "u"));
  await expect(page.locator('[data-funnel-node-type="offer_price"]:visible')).toContainText("1,234");
  const checkoutPath = await checkoutLink.getAttribute("href");
  expect(checkoutPath).not.toBeNull();
  const stepId = checkoutPath!.split("/").at(-2)!;
  await checkoutLink.click();
  let admissions = 0;
  let checkouts = 0;
  let validCheckoutShape = false;
  let initialIdentity: unknown;
  let sameRetryIdentity = false;
  await page.route("**/api/payments/checkout/admission", async route => {
    admissions++;
    const body = route.request().postDataJSON() as { idempotencyKey: string };
    await route.fulfill({ status: 200, json: {
      admissionToken: `ca1.test_only_transport.${"a".repeat(43)}`,
      idempotencyKey: body.idempotencyKey, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } });
  });
  await page.route("**/api/payments/checkout", async route => {
    checkouts++;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    // Keep only a boolean; never log or attach buyer details or admission values.
    const reference = body.funnel as Record<string, unknown>;
    validCheckoutShape = body.productId === fixture.product.id && body.agreementAccepted === true
      && reference.slug === slug && reference.stepId === stepId
      && Number.isInteger(reference.expectedVersion) && Number.isInteger(reference.expectedProductRevision)
      && (body.orderBump as { productId?: string })?.productId === fixture.bump.id
      && !Object.hasOwn(body, "amountCents") && !Object.hasOwn(body, "priceCents");
    if (checkouts === 1) {
      initialIdentity = body.idempotencyKey;
      return route.fulfill({ status: 503, json: { error: "TEST_ONLY_TRANSPORT_FAILURE" } });
    }
    sameRetryIdentity = body.idempotencyKey === initialIdentity;
    // Successful transport initiation is not a real transaction or payment.
    await route.fulfill({ status: 200, json: {
      ok: true, provider: "demo", orderNumber: "TEST_ONLY_MOCK", transactionId: "test-only-mock",
      amountCents: 146800, currency: "TWD", checkoutUrl: `${origin}/checkout/result`,
      nextAction: "continue_with_provider", externalRequired: false,
    } });
  });
  await page.getByRole("textbox", { name: "姓名", exact: true }).fill("TEST ONLY Buyer");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("test-only-buyer@example.test");
  await page.getByRole("textbox", { name: "電話", exact: true }).fill("0912345678");
  await expect(page.getByRole("textbox", { name: "收件人", exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "下一步：確認訂單", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "收件人", exact: true })).toBeVisible();
  expect(admissions).toBe(0);
  expect(checkouts).toBe(0);
  await page.getByRole("textbox", { name: "收件人", exact: true }).fill("TEST ONLY Recipient");
  await page.getByRole("textbox", { name: "收件電話", exact: true }).fill("0912345678");
  await page.getByRole("textbox", { name: "縣市", exact: true }).fill("TEST ONLY City");
  await page.getByRole("textbox", { name: "鄉鎮市區", exact: true }).fill("TEST ONLY District");
  await page.getByRole("textbox", { name: "地址", exact: true }).fill("TEST ONLY Address");
  await page.locator('[name="orderBumpSelected"]:visible').check();
  await expect(page.getByText("本次結帳總額").and(page.locator(":visible")).locator("..")).toContainText("1,468");
  await page.locator('[name="policyAcknowledgement"]:visible').check();
  await page.getByRole("checkbox", { name: agreement, exact: true }).check();
  await page.getByRole("button", { name: `購買「${fixture.product.name}」`, exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "付款服務目前尚未就緒；尚未向你收款，請稍後重試或聯絡商家確認付款設定。" })).toBeVisible();
  expect(admissions).toBe(1);
  expect(checkouts).toBe(1);
  expect(validCheckoutShape).toBe(true);
  // APIRequestContext bypasses page interception: this is the actual local API schema gate.
  const tampered = await page.request.post("/api/payments/checkout", {
    headers: { origin, "x-celebratedeal-client": "web" },
    data: {
      vendorId: fixture.vendor.id, productId: fixture.product.id, idempotencyKey: randomUUID(),
      admissionToken: `ca1.test_only_transport.${"a".repeat(43)}`, amountCents: 1,
      funnel: { slug, stepId },
    },
  });
  expect(tampered.status()).toBe(400);
  expect(await db.commerceOrder.count({ where: { vendorId: fixture.vendor.id } })).toBe(0);
  // The screenshot contains synthetic fixture values only; traces and videos stay off.
  const screenshot = process.env.FUNNEL_COMMERCE_QA_SCREENSHOT_DIR
    ? join(process.env.FUNNEL_COMMERCE_QA_SCREENSHOT_DIR, "commerce-transport-mock.png")
    : testInfo.outputPath("commerce-transport-mock.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.getByRole("button", { name: `購買「${fixture.product.name}」`, exact: true }).click();
  await expect(page).toHaveURL(/\/checkout\/result$/u);
  expect(admissions).toBe(1);
  expect(checkouts).toBe(2);
  expect(sameRetryIdentity).toBe(true);
  await expect(page.getByRole("heading", { name: "目前瀏覽器找不到可顯示的訂單" })).toBeVisible();
  expect(await db.commerceOrder.count({ where: { vendorId: fixture.vendor.id } })).toBe(0);
  expect(errors).toEqual([]);
});
