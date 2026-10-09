import { fixedBrowserEnvironment, validateInvocation } from "./mvp-payuni-sandbox-e2e.mjs";
import { observeIssuedRecovery } from "./payuni-issued-recovery-observation.mjs";

const UPP = "https://sandbox-api.payuni.com.tw/api/upp";
// Public PayUni Sandbox fixture: ECI mismatch with automatic authorization cancellation.
// https://docs.payuni.com.tw/web/#/7/374 — never a real payment card.
export const PUBLIC_FAILURE_CARD = "4147631000000002";
function requireSafe(condition) {
  if (!condition) throw new Error("PAYUNI_ISSUED_RECOVERY_BROWSER_REJECTED");
}

/** Keep the original provider page alive. A retry uses its existing card form
 * exactly once; no second UPP POST, replacement checkout or recreated page.
 * The provider query determines whether the original TradeNo was preserved.
 */
export async function observeIssuedRecoveryBrowser({ prepared, queryProvider }, dependencies = {}) {
  requireSafe(validateInvocation(prepared?.invocation).ok && typeof queryProvider === "function");
  const { invocation, checkout, supportCookie } = prepared;
  requireSafe(checkout?.formAction === UPP && checkout.formMethod === "POST"
    && Number.isSafeInteger(checkout.amountCents) && checkout.amountCents > 0 && checkout.amountCents % 100 === 0
    && typeof checkout.orderNumber === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(checkout.orderNumber)
    && typeof supportCookie === "string" && /^celebrate_support_[A-Za-z0-9_]+=[^;\s]+$/.test(supportCookie));
  const { chromium } = dependencies.playwright ?? await import("playwright");
  const browser = await chromium.launch({ headless: true, env: fixedBrowserEnvironment(), args: ["--no-proxy-server", "--disable-quic"] });
  let initialSubmissions = 0;
  let retries = 0;
  try {
    const context = await browser.newContext({ locale: "zh-TW" });
    const origin = `https://${invocation.previewHost}`;
    const allowed = new Set([invocation.previewHost, "sandbox-api.payuni.com.tw", "sandbox-vendor.payuni.com.tw"]);
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.protocol === "https:" && allowed.has(url.hostname) ? route.continue() : route.abort();
    });
    const separator = supportCookie.indexOf("=");
    await context.addCookies([{ name: supportCookie.slice(0, separator), value: supportCookie.slice(separator + 1),
      url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const document = await context.request.post(UPP, { form: checkout.formPayload, maxRedirects: 0, failOnStatusCode: false, timeout: 10000 });
    requireSafe(document.ok());
    await page.route(UPP, route => route.fulfill({ response: document }), { times: 1 });
    await page.goto(UPP, { waitUntil: "commit", timeout: 10000 });
    requireSafe(page.url() === UPP);
    await page.getByText("一次付清", { exact: true }).click();
    await page.locator('input[name="radioOptionpayGroupCredit"]').check();
    const card = page.getByPlaceholder("16 碼或 19 碼");
    const expiry = page.getByPlaceholder("MM/YY");
    const cvv = page.getByPlaceholder("***");
    const submit = page.getByRole("button", { name: "確認送出", exact: true });
    async function fillCard(number) {
      await card.fill("");
      await card.pressSequentially(number);
      await expiry.fill("");
      await expiry.pressSequentially(invocation.cardExpiry);
      await cvv.fill("");
      await cvv.pressSequentially(invocation.cardCvv);
    }
    await fillCard(PUBLIC_FAILURE_CARD);
    await page.getByPlaceholder("example@example.com").fill("wp4-buyer-v1@invalid.example");
    initialSubmissions = 1;
    await submit.click();
    await page.waitForTimeout(5000);
    const receipt = await observeIssuedRecovery({
      expected: { orderNumber: checkout.orderNumber, amount: checkout.amountCents / 100 }, queryProvider,
      originalPage: {
        retryAvailable: async () => page.url() === UPP && await card.isVisible() && await expiry.isVisible()
          && await cvv.isVisible() && await submit.isVisible() && await submit.isEnabled()
          && await page.locator('[role="dialog"], .modal.show, .swal2-popup').filter({ visible: true }).count() === 0,
        retryOnce: async () => {
          requireSafe(retries === 0 && page.url() === UPP);
          retries = 1;
          await fillCard(invocation.cardNumber);
          await submit.click();
          await page.waitForTimeout(5000);
        },
      },
    });
    return { ...receipt, publicFailureScenario: "ECI_MISMATCH_AUTO_CANCEL", initialCardSubmissions: initialSubmissions,
      originalPageCardResubmissions: retries, initialUppPosts: 1 };
  } catch {
    // No browser/provider/card payloads escape on failure, and no retry fallback.
    throw new Error("PAYUNI_ISSUED_RECOVERY_BROWSER_REJECTED");
  } finally {
    await browser.close();
  }
}
