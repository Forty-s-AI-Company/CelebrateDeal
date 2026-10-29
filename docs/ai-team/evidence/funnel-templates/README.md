# 名單頁與銷售頁範本：不跑版 QA 證據

- 執行：2026-10-29，`npm run qa:template-layout -- --templates=<32 個 id> --stress --jpeg --widths=1440,1280,1024,768,390,360`（next dev 鏡像、合成資料；sell 範本由 harness 帶入合成商品「範例方案（合成資料）」）。
- 範圍：8 個名單頁＋8 個名單感謝頁、8 個銷售頁＋8 個訂單感謝頁，共 32 頁 × 6 寬度 × 一般／壓力文案 = **384 回合，0 項失敗**（`report.json`）。
- 截圖：每頁 1440 與 390 的一般文案全頁截圖（`<id>@<寬度>.jpg`）。其餘寬度與壓力文案截圖在本機 `artifacts/funnel-template-qa/final/`（gitignore）。
- 人工檢查：32 頁的 1440／390 截圖都已逐一看過（首屏、表單、報價卡、手機排版、感謝頁）。

| 名單頁 | 銷售頁 |
|---|---|
| `leads-checklist-minimal` 極簡清單索取頁 | `sales-course-watercolor` 長篇課程銷售頁 |
| `leads-ebook-cafe` 電子書封面名單頁 | `sales-digital-planner` 短版數位商品頁 |
| `leads-toolkit-freelance` 範本工具包名單頁 | `sales-coaching-luxe` 高價陪跑方案頁（黑金） |
| `leads-selfcheck-sleep` 自我檢測報告名單頁 | `sales-product-coffee` 實體商品銷售頁 |
| `leads-email-course-photo` 免費 Email 課程名單頁 | `sales-presale-picturebook` 預購銷售頁 |
| `leads-waitlist-outdoor` 新品候補名單頁（深色） | `sales-saas-plans` 訂閱方案銷售頁 |
| `leads-newsletter-editorial` 電子報訂閱頁（編輯感） | `sales-tripwire-mealprep` 低價入門商品頁 |
| `leads-consult-interior` 免費諮詢預約頁 | `sales-service-photo` 服務方案銷售頁 |

每個範本的感謝頁 id 是 `<id>-thanks`。

審查後複驗（同日）：感謝頁文案（leads 01–06）與 sales-07 截止提示文字修改、L-7 只認可點擊的結帳連結後，重跑 9 頁 × 6 寬度 × 一般／壓力 = 108 回合，0 項失敗；上方 1440／390 截圖已換成複驗版本（`report.json` 為第一次全量執行的報告）。
