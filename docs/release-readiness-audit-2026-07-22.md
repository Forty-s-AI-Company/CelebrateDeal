# CelebrateDeal Staging 上線收斂驗收（2026-07-22）

## 結論

- 應用程式本身沒有已知未修正的 P0；本輪確認並修正 4 個 P1 與 1 個測試基礎設施問題。
- 最終 Preview `https://celebrate-deal-5g7jk5kri-a25814740s-projects.vercel.app` 已部署完成，health、preflight、登入頁瀏覽器驗收皆通過。
- 目前仍有 1 個外部 P0：原先被當成 Staging 的 `celebratedeal.carry-digital-nomad.in.net`，實際是 Vercel Production target，且直播測試頁目前回 HTTP 500。建立獨立 Staging callback host 前，不得再執行 PayUni Sandbox 瀏覽器付款。
- AI Team、Supervisor、Watchdog 與 revive timers 在整個驗收期間保持停用。

## 本輪修正

| Commit | 等級 | 修正 |
| --- | --- | --- |
| `f27a170` | P1 | 付款 webhook 與 retry 只保存、回傳封閉錯誤碼，不再洩漏 provider、資料庫或內部例外原文。 |
| `5a25c5b` | P1 | Cloudflare webhook 遇到未知狀態或多租戶 UID 碰撞時 fail closed，不再批次更新多筆影片。 |
| `cfe47eb` | P1 | 出款批次只允許 `draft -> exported`，以條件式更新阻止併發或終態倒退。 |
| `d4343d2` | Test infra | E2E 固定使用隔離的 memory rate limiter；Preview 的 Upstash 另行線上驗收，避免 429 測試因本機 env 被靜默跳過。 |
| `57cc958` | P0 safety | PayUni Sandbox QA 必須明確指定非 Production 的 Staging host；已知 Production host 即使被加入白名單也會拒絕。 |

## Code Review

### P0

1. **外部環境／PayUni callback host**：目前沒有獨立、公開且非 Production target 的 Staging host。既有 custom domain 是 Production target 且直播頁 HTTP 500。這是實際付款驗收與上線前的阻擋，需外部設定處理。

### P1（已修正）

1. 付款 webhook 原始例外可能進入 HTTP response、WebhookEvent 與營運頁。
2. Cloudflare provider UID 沒有租戶資訊，碰撞時舊邏輯會 `updateMany`。
3. 已完成／失敗的 payout batch 可被操作員重新標成 exported。
4. PayUni QA 把 Production alias 硬編碼成 Staging。

### P1（仍待外部驗收）

1. PayUni Sandbox 結帳、callback、query、退款、退款查詢完整閉環。
2. Cloudflare 真實 upload/webhook/Live Input；目前共用 account 只有一個 webhook，不得為 Staging 覆蓋 Production 設定。
3. CSP 仍為 Report-Only；需累積實際流量樣本後才能轉 enforce。
4. Sentry issue 已可見，Production alert rule 與通知送達仍需人工驗收。
5. Production 備份、還原與切換演練必須由人工在正式上線窗口執行。

### P2

1. 第一輪 Playwright 曾在冷啟動等待 webServer 120 秒逾時；手動重現 Next.js 0.6 秒 Ready、首頁冷編譯約 12 秒，之後兩輪皆 25/25。保留為測試穩定性觀察。
2. 本機 `.env.local` 未配置 client Sentry DSN 與明確 environment tag；Preview 已完整配置，不阻擋部署，但本機監控能力較弱。

## 四面向審查

- **安全性**：Server Actions 皆重新驗證 CSRF/auth/role；租戶頁與帳務查詢使用 vendor scope；webhook、job、公開 POST、body size、secret redaction 與未知狀態均採 fail-closed。
- **效能**：本輪修正均為常數時間分類或最多查 2 筆映射；未新增 N+1、無界查詢或 provider 無界重試。
- **可讀性**：付款失敗分類、payout 狀態規則與 PayUni Staging URL 驗證集中於單一 helper，route/action 保持薄層。
- **可維護性**：每個狀態邊界都有拒絕、未知、併發或敏感資料測試；GitHub Actions 既有 push/PR lint、typecheck、unit、E2E、build 門檻保留。

## 本機驗證

- `npm run lint`：通過。
- `npm run typecheck`：通過。
- `npm run test`：93 個測試檔、731 項測試通過。
- `npm run build`：通過，72 個 route/page 完成產出。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `npm run e2e:smoke`：25/25 通過。
- `npm run e2e:smoke`：第二次 25/25 通過。

## Preview 線上驗收

- Vercel target：Preview，非 Production。
- `/api/health`：200，database ok。
- `/api/admin/preflight`：無權限 401；JOB_SECRET 驗證後 200，env、Upstash、Cloudflare 診斷通過。
- job route 無權限 401；授權執行 200，本輪沒有待釋放 reservation。
- Cloudflare webhook 無簽章 401；超量 payload 413。
- checkout 無效 payload 400；Upstash 第 21 次同來源請求 429。
- 測試信只寄送到設定的單一受控收件人；錯誤收件人 403。
- 密碼重設請求 200，沒有回傳 reset URL。
- CSP Report-Only endpoint 204，安全標頭、HSTS、nosniff、frame deny 皆存在。
- Server 與 client Sentry synthetic issues 均可由 project API 查到；source maps 在 Preview build 成功上傳。
- Browser：登入頁有內容與表單，無 Next error overlay、無 console error。
- 檢查 9 個 client assets，未發現 server-only secrets。
- Cloudflare token/webhook GET 唯讀驗證通過；未建立 upload、Live Input，也未修改 webhook。

## PayUni Sandbox

- 本輪執行 2 次上限後停止；兩次都未抵達 PayUni 付款頁或建立 provider 交易。
- 根因不是新的 PayUni provider rejection，而是 QA 目標 custom domain 為 Production target，直播頁 HTTP 500、沒有購買按鈕。
- 先前 `QUERY03001` 外部阻擋仍未被重新驗證或排除。
- 未執行 Production 付款、Production 退款或第三輪重試。

## 成熟度（10 分制）

| 項目 | 分數 | 主要扣分 |
| --- | ---: | --- |
| 身分驗證與帳號安全 | 9.2 | Production MFA／復原碼操作仍需人工抽驗。 |
| 權限與租戶隔離 | 9.3 | Cloudflare 真實 provider UID 全流程尚未在線驗收。 |
| 付款流程 | 5.5 | 缺獨立 Staging callback host，Sandbox 閉環與 Production 驗收未完成。 |
| 帳單／收據／訂閱管理 | 8.8 | 真實付款後帳單狀態與營運對帳仍待驗收。 |
| 庫存 reservation 與資料一致性 | 9.2 | 程式與整合測試完整；Production 併發壓測尚未執行。 |
| Email 與營運通知 | 8.8 | 受控信箱已通過；Production domain 與告警送達仍需人工確認。 |
| Cloudflare Stream／影片流程 | 7.2 | API、簽章、隔離已測；真實 upload/webhook/Live Input 未驗。 |
| Sentry／監控／錯誤追蹤 | 9.0 | server/client issue 與 source map 通過；正式 alert delivery 未驗。 |
| Rate Limit／CSP／安全標頭 | 8.6 | Upstash 與 429 通過；CSP 尚未 enforce。 |
| Staging／Production 環境隔離 | 6.8 | Preview DB/env 隔離良好，但付款 custom domain 被誤當 Staging。 |
| 測試覆蓋與穩定性 | 9.4 | 731 unit + 兩輪 25/25；保留一次冷啟動 timeout 觀察。 |
| 備份、還原與 Runbook | 8.0 | Staging restore drill 已有紀錄；Production drill 待人工。 |
| **整體上線販售成熟度** | **7.6** | 核心程式成熟，主要缺口集中在付款 Staging 身分與 Production 外部驗收。 |

## 下一個最值得處理的任務

建立 `staging` 專用 custom domain，確認 Vercel target 非 Production、Preview Protection 不阻擋 PayUni callback，並讓 Preview 的 `NEXT_PUBLIC_APP_URL`、`PAYUNI_TEST_APP_URL` 與 `PAYUNI_STAGING_ALLOWED_HOST` 全部對齊該網址。完成後再執行一輪有目的的 PayUni Sandbox 閉環。
