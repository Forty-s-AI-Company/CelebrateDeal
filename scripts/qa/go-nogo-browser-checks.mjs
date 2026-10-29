// Go/No-Go 瀏覽器檢查（staging，合成商家帳號）。
//   STAGING_URL=... QA_EMAIL=... QA_PASSWORD=... node scripts/qa/go-nogo-browser-checks.mjs
// 帳密只存在目前行程的環境變數，不寫入檔案或輸出。
// 副作用（僅限合成商家）：新增一個互動角色、一份直播草稿。不送出結帳、不付款、不寄信。
import { base, finish, launch, login, record, shot } from "./go-nogo-lib.mjs";

const CHECKOUT_PATH = process.env.CHECKOUT_PATH; // /checkout/<vendorId>/<productId>（公開頁，唯讀）
const TAKEN_SLUG = process.env.TAKEN_SLUG ?? "summer-glow-live"; // 其他商家已使用的直播網址
const { browser, context, page } = await launch();

// F-101：買家端結帳頁沒有內部字樣（桌機與手機各一張截圖）
if (CHECKOUT_PATH) {
  const banned = ["owner", "核准", "正式上線前", "內部", "TODO", "placeholder", "lorem", "待律師", "草稿"];
  const buyer = await browser.newContext({ locale: "zh-TW", viewport: { width: 1280, height: 900 } });
  const bp = await buyer.newPage();
  const res = await bp.goto(base + CHECKOUT_PATH);
  await bp.waitForLoadState("networkidle").catch(() => {});
  const text = await bp.locator("body").innerText();
  const hits = banned.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  const hasEffective = /自 \d{4} 年 \d{1,2} 月 \d{1,2} 日 起生效/u.test(text);
  await shot(bp, "F-101-checkout-desktop");
  await bp.setViewportSize({ width: 390, height: 844 });
  await shot(bp, "F-101-checkout-mobile");
  record("F-101", "結帳頁買家端無內部字樣、改顯示政策生效日", res.status() === 200 && hits.length === 0 && hasEffective, `status=${res.status()} 命中內部字樣=${JSON.stringify(hits)} 顯示生效日=${hasEffective}`);
  await buyer.close();
}

// F-079：中文 404 與返回出口（登入前後各一次）
{
  const res = await page.goto(`${base}/__go-nogo-no-such-page__`);
  const text = await page.locator("body").innerText();
  const home = await page.getByRole("link", { name: "回首頁" }).count();
  await shot(page, "F-079-404");
  record("F-079", "中文 404 與返回出口（截圖）", res.status() === 404 && text.includes("找不到這個頁面") && home > 0 && !/not be found/i.test(text), `status=${res.status()} 回首頁連結=${home}`);
}

await login(page);

// F-110：伺服器（Vercel 為 UTC）渲染的時間顯示台灣時間。草稿儲存時間與現在的台灣時間相差不到 10 分鐘。
// F-107：直播網址撞名時，欄位當場顯示錯誤，頁面不會整頁出錯。
{
  await page.goto(`${base}/lives/new`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByText("從空白開始").first().click();
  await page.fill('input[name="title"]', "GoNoGo 撞名測試");
  await page.waitForTimeout(1500);
  await page.fill("#live-slug", TAKEN_SLUG);
  await page.waitForTimeout(3500);
  const msg = await page.locator("#live-slug-message").innerText();
  const invalid = await page.getAttribute("#live-slug", "aria-invalid");
  const fatal = await page.getByText(/Application error|Something went wrong|找不到這個頁面/).count();
  await shot(page, "F-107-slug-taken");
  record("F-107", "直播網址撞名時欄位顯示錯誤、非整頁錯誤", msg.includes("已被使用") && invalid === "true" && fatal === 0, `欄位訊息=${msg} aria-invalid=${invalid} 整頁錯誤=${fatal}`);

  // 重新載入，草稿續編提示上的「上次儲存於」是伺服器端以台灣時間渲染
  await page.waitForTimeout(2000);
  await page.goto(`${base}/lives/new`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const saved = (await page.locator("time").first().innerText().catch(() => "")).trim();
  const m = saved.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/u);
  let diffMin = null;
  if (m) {
    const shown = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - 8 * 3600_000; // 把顯示值當作 UTC+8 換回真實瞬間
    diffMin = Math.abs(Date.now() - shown) / 60_000;
  }
  await shot(page, "F-110-taipei-time");
  record("F-110", "伺服器渲染時間為台灣時間（草稿儲存時間，與現在的 UTC+8 相差 < 10 分鐘）", diffMin !== null && diffMin < 10, `畫面=${saved} 差距(分)=${diffMin === null ? "無法解析" : diffMin.toFixed(1)} 現在UTC=${new Date().toISOString()}`);
}

// F-103：新建角色預設可用於腳本，腳本頁角色下拉可選到
{
  const name = `GoNoGo角色${Date.now().toString().slice(-6)}`;
  await page.goto(`${base}/interaction-roles`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const scheduledDefault = await page.locator('input[name="isScheduled"]').isChecked();
  await page.fill('main input[name="name"]', name);
  await Promise.all([page.waitForLoadState("networkidle"), page.getByRole("button", { name: "新增", exact: true }).click()]);
  await page.waitForTimeout(2000);
  await page.goto(`${base}/interaction-scripts/new`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const options = await page.locator("select").evaluateAll((els) => els.flatMap((e) => [...e.options].map((o) => o.text)));
  const available = options.some((o) => o.includes(name));
  const emptyHint = await page.getByText("還沒有可以在腳本中發言的角色").count();
  await shot(page, "F-103-script-role-dropdown");
  record("F-103", "新建角色預設為排程角色，腳本頁角色下拉可選到該角色", scheduledDefault && available && emptyHint === 0, `預設勾選排程角色=${scheduledDefault} 下拉含新角色=${available} 空狀態提示=${emptyHint}`);
}

await context.close();
await browser.close();
finish();
