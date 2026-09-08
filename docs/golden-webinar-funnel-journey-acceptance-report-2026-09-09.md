# CelebrateDeal 全漏斗十二步終極黃金旅程驗收報告

日期：2026-09-09

模式：`ai-team-lite`／`PRELAUNCH_DEV_AUTONOMOUS`

範圍：本機 deterministic integration rehearsal；未連線 Production、正式付款、正式資料庫、正式發票或 LINE 正式服務。

## 驗收結論

`src/lib/golden-webinar-funnel-journey.test.ts` 已由 10 步擴充為完整的 12 步全生命週期黃金閉環。既有報名、偽直播、即時互動、自動追單、諮詢、CRM、ECPay、電子發票、佣金與功能開關流程，現已進一步串接學員課後會員中心與 LINE 官方帳號 Rich Menu。

最終結果：**LOCAL REHEARSAL PASS**。12/12 步驟與全部六項指定品質門檻均通過。本結果證明本機程式契約及 deterministic lifecycle 成立，不代表 Production readiness，也不代表正式第三方服務已完成交易或 API 驗證。

## 十二步黃金旅程結果

| 步驟 | 驗證內容 | 結果 |
| --- | --- | --- |
| Step 1 漏斗建置 | 高客單範本、輪播、倒數、三欄價格卡與防重複報名 | PASS |
| Step 2 常青偽直播 | JIT 5 分鐘倒數、精確 offset、快轉與倍速播放 fail closed | PASS |
| Step 3 即時互動 | 投票、deterministic 抽獎、hash 核銷碼與脫敏買家跑馬燈 | PASS |
| Step 4 自動追單 | 觀看 1,800 秒觸發 9 折券、LINE 動作與高意向標籤 | PASS |
| Step 5 諮詢預約 | 時段產生、問卷快照與撞單排除 | PASS |
| Step 6 學員 360 CRM | 聚合完整時間軸、顧問備註與 `closed_won` | PASS |
| Step 7 ECPay 金流 | SHA-256 `CheckMacValue`、簽章驗證與成功 callback normalization | PASS |
| Step 8 B2C 電子發票 | 載具校驗、5% VAT、防偽 envelope 與跨租戶拒絕 | PASS |
| Step 9 佣金與出款 | 階梯佣金、所得稅、2.11% 二代健保、勞報與 CSV 注入防護 | PASS |
| Step 10 功能開關 | 五大模組導航隱藏、直接路由邊界與 tenant-qualified Prisma 契約 | PASS |
| Step 11 學員會員中心 | 15 分鐘 HMAC Magic Link、竄改拒絕、無明文 email 落庫、課程交付、tenant-qualified `.ics` 匯出與發票載具遮罩 | PASS |
| Step 12 LINE Rich Menu | 2500×1686 六格黃金版型、schema 無重疊／無越界、四類 URL 佔位符全替換、`selected: true` 與預設選單 API lifecycle | PASS |

## Step 11／12 具體證據

- Magic Link 使用正式 `createStudentPortalAccessToken` 與 `verifyStudentPortalAccessToken`，確認 HMAC 簽章為 43 字元 base64url、綁定 `vendorId`／customer key、竄改後 fail closed，且 token store 不保存原始 email。
- 學員中心使用正式 `getStudentPortalDashboard` 聚合已付款課程交付、1 對 1 諮詢及電子發票；課程目的地通過 HTTPS host/path allowlist，發票手機載具只呈現遮罩值。
- `.ics` 直接呼叫正式 calendar route，確認 booking query 同時限制 booking id、vendor id 與 customer key，回傳 `text/calendar`、附件檔名與 `VEVENT`。
- Rich Menu 使用正式 `golden-6` template 及 `LineRichMenuSchema`，六格座標通過無重疊與邊界驗證；`live_url`、`consultation_url`、`portal_url`、`voucher_url` 全數替換且不殘留 placeholder。
- 預設選單以 deterministic mock adapter 驗證建立後呼叫 `/user/all/richmenu/{id}`，不連線 LINE 正式 API、不讀取 Channel Access Token。

## 安全與資料邊界

- 全程只使用 `example.test`、synthetic 訂單／載具與測試用簽章材料，未讀取或輸出 `.env*`、Token、Cookie、正式客戶資料或付款資料。
- Step 11 的查詢與能力 token 均綁定 `vendor-golden` 及 opaque customer key；跨租戶與 token 竄改採 fail-closed 行為。
- Step 12 只接受核准 placeholder 或安全 URI schema；本次 API lifecycle 由記憶體 adapter 驗證，外部 side effect 為零。

## 實際驗證紀錄

| 命令 | 結果 |
| --- | --- |
| `npx vitest run src/lib/golden-webinar-funnel-journey.test.ts` | PASS，1 file／12 tests |
| `npm run test:interactions` | PASS，27 files／280 tests |
| `npm run test:contracts` | PASS，924/924 tests |
| `npm run typecheck:strict-index` | PASS |
| `npm run typecheck` | PASS |
| `npm run secret:scan` | PASS，`secret_scan_passed` |

## Done, Gaps, Next

- **Done：**十二步 deterministic 黃金旅程、Step 11／12 安全與租戶隔離 assertions、六項指定驗證及本報告均完成。
- **Gaps：**本輪未執行 Production、正式 LINE／ECPay API、正式寄信或正式資料庫驗證；這些不在本機 rehearsal 授權範圍內。
- **Next：**若進入 release candidate，可另行透過受保護 Preview／staging workflow 驗證真實第三方 sandbox lineage；Production deployment 仍須人工核准。

