# Go/No-Go 證據索引（2026-10-29 預檢）

驗證對象：staging 固定網址（合成資料）。檢查表：`docs/goal-beta-prep-2026Q4/GO-NO-GO.md`。
本資料夾不含任何帳號、密碼、Token 或 Cookie；瀏覽器腳本只從目前行程的環境變數讀帳密。

## 重現方式

```
# 公開端點（不登入）
STAGING_URL=<staging 網址> node scripts/qa/go-nogo-public-probe.mjs
STAGING_URL=<staging 網址> node scripts/qa/go-nogo-policy-probe.mjs
# 登入後（合成商家帳號，不得啟用 MFA；只新增一個互動角色與一份直播草稿）
STAGING_URL=<staging 網址> QA_EMAIL=<合成帳號> QA_PASSWORD=<密碼> \
CHECKOUT_PATH=/checkout/<vendorId>/<productId> node scripts/qa/go-nogo-browser-checks.mjs
```

登入有限流（每帳號 15 分鐘 10 次）；腳本只登入一次，重跑前請間隔。

## 證據檔

| 檔案 | 內容 |
|---|---|
| `public-probe.txt` | health、中文 404、邀請制註冊頁、CSP／安全標頭、排程端點未帶密鑰回 401（10 項全過） |
| `browser-checks.txt` | F-101、F-079、F-107、F-110、F-103 的 Playwright 結果（5 項全過） |
| `F-101-checkout-desktop.png`、`F-101-checkout-mobile.png` | 買家端結帳頁（無內部字樣、顯示政策生效日） |
| `F-079-404.png` | 中文 404 與「回首頁」 |
| `F-107-slug-taken.png` | 直播網址撞名，欄位紅字提示，頁面正常 |
| `F-110-taipei-time.png` | 草稿「上次儲存於」為台灣時間（伺服器在 UTC 的 Vercel 上渲染） |
| `F-103-script-role-dropdown.png` | 新建角色出現在腳本頁角色下拉 |
| `vitest-targeted.txt` | 19 個測試檔、466 項通過，加 `actions.test.ts` slug 5 項 |

## GitHub Actions 證據（唯讀，`gh run view`）

- B2／F-042：`scheduled-jobs` run `40826761897`（2026-10-29 06:01Z）日誌為
  `email-deliveries http=200 outcome=ok`、`line-notifications http=200 outcome=ok`、`webhook-retry http=200 outcome=ok`；
  每日 run `40773959731` 為 `electronic-invoices http=202 outcome=ok`。10-24 起全部成功，10-19～10-23 的 22 次失敗發生在 O-18 切 alias 之前。
- F-026／migration：`staging-migrate` run `40646327623`（10-28）日誌為「128 migrations found … All migrations have been successfully applied」，
  與 repo 的 128 個 migration 數量相同，沒有未套用項目。
- master 最新 `ci` run `40804657424`（commit `e4ec09a4`）`quality` 成功；該 workflow 會對拋棄式 PostgreSQL 套用全部 migration 並跑
  `rls-catalog.db.test.ts`（F-026 anon／authenticated 無權限、全表 RLS）。

## 分類（a 可在 staging 唯讀或合成資料驗證；b 可由 repo 測試或 CI 證明；c 需要 owner 帳號、付款或金錢）

### §1 L0 核心

| Finding | 類 | 結果 |
|---|---|---|
| F-168 | c | 需要 O-14 的 QA TOTP secret |
| F-024 | c | 需要 O-3 平台管理員登記 TOTP（`recent-mfa.test.ts`、`mfa.test.ts` 通過，只是輔助證據） |
| F-037 | c | 需要 O-2 Sandbox 樣本（`payuni.test.ts`、payments webhook 測試通過，只是輔助證據） |
| F-114 | c | 需要 O-10／O-11 條款定稿或封測協議（`registration-actions.test.ts` 通過） |
| F-026 | b | 通過（staging-migrate 日誌、CI quality） |
| F-042 | a+b | 通過（run 日誌）；另有頻率問題，見檢查表缺陷 B-1 |
| F-090 | c | O-15 決定；補充觀察：`x-vercel-id` 為 `hnd1`，函式在東京執行 |
| F-058、F-074 | c | O-4、還原演練 |
| F-101 | a | 通過（截圖＋腳本） |
| F-110 | a | 通過（截圖＋腳本） |
| F-079 | a | 通過（截圖＋腳本） |
| F-103 | a | 通過（截圖＋腳本） |
| F-104 | c | O-11 律師意見 |
| F-107 | a+b | 通過（欄位層級錯誤；送出時 redirect 由 `actions.test.ts` 證明） |
| F-113 | b | 部分：`live-publish-readiness.test.ts`、`live-stepper-form.test.tsx` 證明無腳本不列入阻擋；staging 完整發布走查需影片、表單、Email 範本，併入 O-13 |
| F-143 | b | 部分：`sentry-scrub.test.ts` 通過，server／edge／client 三份設定都套用 `sentryDataCollection` 與 `beforeSend`；staging 事件抽查需 Sentry 帳號（owner） |
| F-031 ① | b | 通過（`DECISIONS-2026Q4.md` D-39、`scheduled-jobs-runbook.md` 第 104 行） |

### §2 owner 事項

全部屬 c。只做了不需帳號的唯讀觀察，沒有勾選：
- O-7：staging 回應標頭 `server: Vercel`、無 `cf-ray`，目前沒有經過 Cloudflare 代理。
- O-9／O-10／O-11：`/policies*` 顯示營運者「Carry Digital Nomad 凱瑞數位」與客服信箱、版本 2026.10.18、「本版本尚未生效」（預定 2026-11-01），沒有占位字樣。簽核仍是 owner 的事。
- O-26：程式端（`turnstile.test.ts` 通過）就緒；金鑰是否已設定無法從外部判斷（邀請制註冊頁不顯示 Turnstile），維持邀請制。
- O-18 已於 10-25 完成，維持 ☑。

### §3 首次成功路徑、§4 已接受風險

§3 全屬 O-13（owner 以客戶身分走一次，含 Sandbox 測試卡）。§4 為風險接受紀錄，未逐項驗證。
