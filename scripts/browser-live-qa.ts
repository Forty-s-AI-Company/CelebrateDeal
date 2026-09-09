import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

interface Issue {
  category: "CONSOLE_ERROR" | "PAGE_CRASH" | "HTTP_ERROR" | "UI_BUG" | "NAV_ERROR";
  url: string;
  message: string;
  details?: string;
}

const issues: Issue[] = [];
const screenshotDir = path.resolve(process.cwd(), "reports/browser-qa-screenshots");

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

function attachPageListeners(page: Page, label: string) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore favicon or known benign dev noise if any
      issues.push({
        category: "CONSOLE_ERROR",
        url: page.url(),
        message: `[${label}] Console error: ${text}`,
      });
      console.log(`❌ [Console Error on ${label}]: ${text}`);
    }
  });

  page.on("pageerror", (err) => {
    issues.push({
      category: "PAGE_CRASH",
      url: page.url(),
      message: `[${label}] Uncaught page exception: ${err.message}`,
      details: err.stack,
    });
    console.log(`💥 [Page Crash on ${label}]: ${err.message}`);
  });

  page.on("response", (res) => {
    if (res.status() >= 400 && !res.url().includes("/favicon.ico")) {
      // Ignore 404 for expected negative tests
      issues.push({
        category: "HTTP_ERROR",
        url: page.url(),
        message: `[${label}] HTTP ${res.status()} on ${res.url()}`,
      });
      console.log(`⚠️ [HTTP ${res.status()} on ${label}]: ${res.url()}`);
    }
  });
}

async function dismissAnnouncementIfOpen(page: Page) {
  const closeBtn = page.locator('[data-testid="announcement-center-close"]');
  if (await closeBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    console.log("   ℹ 偵測到『進站最新消息』彈窗遮擋，正在點擊關閉按鈕...");
    issues.push({
      category: "UI_BUG",
      url: page.url(),
      message: "進站首頁跳轉 /login?from=home 時，全螢幕公告彈窗會自動開啟並遮蔽整個登入表單，使用者必須手動尋找右上角叉叉才能登入，對新使用者有強烈阻礙。",
    });
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function runBrowserQA() {
  console.log("🚀 正在開啟 Chromium 瀏覽器進行完整網站功能測試...");
  const browser = await chromium.launch({
    headless: false, // 開啟實體瀏覽器視窗，讓使用者看得到測試畫面
    slowMo: 300, // 稍微放慢速度以便肉眼觀察
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  attachPageListeners(page, "Main");

  const baseUrl = "http://127.0.0.1:31023";

  try {
    // ----------------------------------------------------
    // 測試 1: 首頁自動跳轉至登入頁面
    // ----------------------------------------------------
    console.log("\n▶ [測試 1] 首頁 (/) 導向測試...");
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const currentUrl = page.url();
    console.log(`   當前頁面網址: ${currentUrl}`);
    await page.screenshot({ path: path.join(screenshotDir, "01_root_redirect.png") });
    if (!currentUrl.includes("/login")) {
      issues.push({
        category: "UI_BUG",
        url: currentUrl,
        message: "首頁未正常導向至 /login",
      });
    }

    await dismissAnnouncementIfOpen(page);

    // ----------------------------------------------------
    // 測試 2: 登入頁表單與錯誤密碼驗證
    // ----------------------------------------------------
    console.log("\n▶ [測試 2] 登入頁 (/login) 錯誤密碼測試...");
    await page.fill('input[name="email"]', "demo@celebratedeal.local");
    await page.fill('input[name="password"]', "wrongpassword123");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/login?*error=*", { timeout: 10000 }).catch(() => {});
    const alertEl = page.locator('[role="alert"]');
    await alertEl.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const errorAlert = await alertEl.textContent().catch(() => null);
    console.log(`   錯誤提示訊息: ${errorAlert ?? "無提示"}`);
    await page.screenshot({ path: path.join(screenshotDir, "02_login_error_state.png") });
    if (!errorAlert || !errorAlert.includes("不正確")) {
      issues.push({
        category: "UI_BUG",
        url: page.url(),
        message: "輸入錯誤密碼時，未顯示適當的錯誤提示 (例如：帳號或密碼不正確)",
      });
    }

    // ----------------------------------------------------
    // 測試 3: 正確登入 (demo@celebratedeal.local / demo1234)
    // ----------------------------------------------------
    console.log("\n▶ [測試 3] 正確帳號登入...");
    await page.fill('input[name="email"]', "demo@celebratedeal.local");
    await page.fill('input[name="password"]', "demo1234");
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    console.log(`   登入後網址: ${page.url()}`);
    await page.screenshot({ path: path.join(screenshotDir, "03_dashboard_after_login.png") });

    if (!page.url().includes("/dashboard")) {
      issues.push({
        category: "UI_BUG",
        url: page.url(),
        message: `登入後未成功跳轉至 /dashboard，目前停留於: ${page.url()}`,
      });
    }

    // ----------------------------------------------------
    // 測試 4: Dashboard 頁面元件檢查
    // ----------------------------------------------------
    console.log("\n▶ [測試 4] Dashboard 戰情室元件與資料檢查...");
    const heading = await page.locator("h1").textContent().catch(() => "");
    console.log(`   Dashboard 標題: ${heading?.trim()}`);
    await page.waitForTimeout(1000);

    // ----------------------------------------------------
    // 測試 5: 後台關鍵路由遍歷測試 (Authenticated App Pages)
    // ----------------------------------------------------
    const adminRoutes = [
      { name: "商品管理", path: "/products", titleCheck: "商品" },
      { name: "新增商品", path: "/products/new", titleCheck: "新增商品" },
      { name: "直播間列表", path: "/lives", titleCheck: "直播" },
      { name: "新增直播", path: "/lives/new", titleCheck: "新增" },
      { name: "表單管理", path: "/forms", titleCheck: "表單" },
      { name: "新增表單", path: "/forms/new", titleCheck: "新增" },
      { name: "顧客名單 (CRM)", path: "/customers", titleCheck: "顧客" },
      { name: "訂單管理", path: "/orders", titleCheck: "訂單" },
      { name: "預約諮詢", path: "/consultations", titleCheck: "諮詢" },
      { name: "分銷分潤", path: "/affiliates", titleCheck: "分銷" },
      { name: "方案訂閱", path: "/billing/plans", titleCheck: "方案" },
      { name: "發票與帳單", path: "/billing/invoices", titleCheck: "帳單" },
      { name: "LINE 官方帳號設定", path: "/settings/line", titleCheck: "LINE" },
      { name: "品牌識別設定", path: "/settings/brand", titleCheck: "品牌" },
      { name: "團隊成員管理", path: "/settings/team", titleCheck: "團隊" },
      { name: "帳號安全 (MFA)", path: "/settings/security", titleCheck: "安全" },
    ];

    for (const route of adminRoutes) {
      console.log(`\n▶ [測試後台頁面] ${route.name} (${route.path})...`);
      try {
        const res = await page.goto(`${baseUrl}${route.path}`, { waitUntil: "networkidle", timeout: 15000 });
        const status = res?.status() ?? 0;
        await page.waitForTimeout(1000);
        const slug = route.path.replace(/\//g, "_").slice(1);
        await page.screenshot({ path: path.join(screenshotDir, `admin_${slug}.png`) });

        if (status >= 400) {
          issues.push({
            category: "HTTP_ERROR",
            url: page.url(),
            message: `後台頁面 ${route.name} (${route.path}) 回傳 HTTP ${status}`,
          });
          console.log(`   ❌ 回傳 HTTP ${status}`);
        } else {
          console.log(`   ✓ 成功載入 (HTTP ${status})`);
        }
      } catch (err: any) {
        issues.push({
          category: "NAV_ERROR",
          url: `${baseUrl}${route.path}`,
          message: `後台頁面 ${route.name} (${route.path}) 載入失敗: ${err.message}`,
        });
        console.log(`   ❌ 載入例外: ${err.message}`);
      }
    }

    // ----------------------------------------------------
    // 測試 6: 外部訪客端 (Viewer Pages: 直播間 / 報名表單 / 結帳)
    // ----------------------------------------------------
    console.log("\n▶ [測試訪客端] 開啟獨立無痕訪客視窗...");
    const guestContext = await browser.newContext({
      viewport: { width: 414, height: 896 }, // 手機模擬視窗 (常見觀看直播情境)
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const guestPage = await guestContext.newPage();
    attachPageListeners(guestPage, "Guest");

    // 6.1 直播間
    console.log("   ▶ 測試直播間 (/live/summer-glow-live)...");
    try {
      const res = await guestPage.goto(`${baseUrl}/live/summer-glow-live`, { waitUntil: "networkidle", timeout: 15000 });
      await guestPage.waitForTimeout(2000);
      await guestPage.screenshot({ path: path.join(screenshotDir, "guest_live_viewer.png") });
      console.log(`   ✓ 直播間狀態: HTTP ${res?.status()}`);
    } catch (err: any) {
      issues.push({
        category: "NAV_ERROR",
        url: `${baseUrl}/live/summer-glow-live`,
        message: `直播間載入失敗: ${err.message}`,
      });
      console.log(`   ❌ 直播間載入失敗: ${err.message}`);
    }

    // 6.2 報名表單
    console.log("   ▶ 測試報名表單 (/form/summer-live-reminder)...");
    try {
      const res = await guestPage.goto(`${baseUrl}/form/summer-live-reminder`, { waitUntil: "networkidle", timeout: 15000 });
      await guestPage.waitForTimeout(2000);
      await guestPage.screenshot({ path: path.join(screenshotDir, "guest_form_page.png") });
      console.log(`   ✓ 報名表單狀態: HTTP ${res?.status()}`);
    } catch (err: any) {
      issues.push({
        category: "NAV_ERROR",
        url: `${baseUrl}/form/summer-live-reminder`,
        message: `報名表單載入失敗: ${err.message}`,
      });
      console.log(`   ❌ 報名表單載入失敗: ${err.message}`);
    }

    // 6.3 商品購買 / 結帳
    console.log("   ▶ 測試商品導購頁 (/p/glow-serum-set)...");
    try {
      const res = await guestPage.goto(`${baseUrl}/p/glow-serum-set`, { waitUntil: "networkidle", timeout: 15000 });
      await guestPage.waitForTimeout(2000);
      await guestPage.screenshot({ path: path.join(screenshotDir, "guest_product_page.png") });
      console.log(`   ✓ 商品頁狀態: HTTP ${res?.status()}`);
    } catch (err: any) {
      issues.push({
        category: "NAV_ERROR",
        url: `${baseUrl}/p/glow-serum-set`,
        message: `商品導購頁載入失敗: ${err.message}`,
      });
      console.log(`   ❌ 商品頁載入失敗: ${err.message}`);
    }

    // 6.4 公開政策與客服頁
    console.log("   ▶ 測試客服支援頁 (/support)...");
    try {
      const res = await guestPage.goto(`${baseUrl}/support`, { waitUntil: "networkidle", timeout: 15000 });
      await guestPage.waitForTimeout(1000);
      await guestPage.screenshot({ path: path.join(screenshotDir, "guest_support_page.png") });
      console.log(`   ✓ 客服支援頁狀態: HTTP ${res?.status()}`);
    } catch (err: any) {
      issues.push({
        category: "NAV_ERROR",
        url: `${baseUrl}/support`,
        message: `客服支援頁載入失敗: ${err.message}`,
      });
    }

    await guestContext.close();

  } finally {
    console.log("\n🏁 測試流程完成，正在關閉瀏覽器視窗...");
    await browser.close();
  }

  // 寫出報告檔案
  const reportPath = path.resolve(process.cwd(), "reports/browser-qa-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(issues, null, 2), "utf-8");
  console.log(`\n📋 完整報告已存檔至: ${reportPath}`);
  console.log(`📸 截圖已儲存至: ${screenshotDir}`);
  console.log(`🔎 發現問題總數: ${issues.length}`);
}

runBrowserQA().catch((err) => {
  console.error("Browser QA Fatal Error:", err);
  process.exit(1);
});
