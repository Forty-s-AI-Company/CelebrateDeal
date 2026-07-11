# CelebrateDeal Pre-Bootstrap Baseline State

更新日期：2026-07-10  
基準分支：`codex/ai-team-skills-automation-foundation`  
基準提交：`22b61fc`

## 目的

這份文件是在建立 AI 團隊、Skills、測試與自動化底座之前的唯讀基準快照，不代表 bootstrap 完成後的即時現況。後續代理必須以程式碼、`AI_TEAM_BOOTSTRAP_REPORT.md` 與本文件交叉驗證，不得將較早的 UX audit 或上線規劃直接視為最新事實。

## 技術棧

- 套件管理：npm，鎖檔為 `package-lock.json`。
- 前端與後端：Next.js 16.2 App Router、React 19.2、TypeScript 5。
- 樣式：Tailwind CSS 4、共用 CSS variables 與少量共用 React UI 元件。
- 資料庫：Prisma 6.19、PostgreSQL；正式環境規劃使用 Supabase PostgreSQL。
- 驗證：自建使用者、雜湊 session token、HttpOnly cookie、TOTP MFA、recovery codes、password reset。
- 影音：Cloudflare Stream VOD、Direct Creator Upload、Live Input、Stream webhook。
- 金流：demo 與 PayUni adapter；ECPay-like adapter 尚未完成 checkout。
- 郵件與監控：Resend、Sentry、PostHog。
- Hosting：Vercel；DNS/CDN/WAF 規劃使用 Cloudflare。
- 測試：Vitest、Playwright、GitHub Actions PostgreSQL service。

## 修改前驗證基準

2026-07-10 實際執行結果：

| 命令 | 結果 |
| --- | --- |
| `npm install` | 通過；546 packages，0 vulnerabilities |
| `npm run lint` | 通過 |
| `npm run typecheck` | 通過 |
| `npm run test` | 通過；8 files、25 tests |
| `npm run build` | 通過；60 routes |

## 現有功能

- 商家多租戶資料模型、使用者、成員、session、密碼登入、MFA、密碼重設與 session revoke。
- 影片、商品、直播、報名表單、訊息模板、互動角色、互動腳本、黑名單、聯盟夥伴與品牌設定。
- 公開直播播放頁、時間軸互動事件、商品浮出、CTA、報名與 analytics/referral click。
- PayUni checkout payload、付款 webhook、退款、重複事件冪等、聯盟佣金、對帳與 retry queue。
- 月結、人工 adjustment、鎖單、payout batch、CSV 匯出與 audit logs。
- Cloudflare direct upload/live input 管理入口、VOD webhook 官方簽章與 shared-secret staging fallback。
- CSRF/origin 防護、敏感 API bearer secret、in-memory/Upstash/WAF rate-limit abstraction。
- GitHub Actions 已在 push/PR 執行 migration、lint、typecheck、unit tests、Chromium smoke、build 與 preflight。

## 半成品與 External Required

- Cloudflare 真實 direct upload 曾回傳 `code=10000 Authentication error`；需外部 dashboard 校正 account ID、token scope 與 account resource。
- PayUni sandbox/production 的真實付款、退款與 dashboard webhook 仍需外部憑證驗收。
- Resend 寄件網域與 password reset 真實收件尚需外部驗證。
- production durable rate limit 必須設定 Upstash Redis 或 Cloudflare WAF；memory provider 不適用多 instance production。
- Sentry、PostHog、Cloudflare、PayUni 與 Resend 的正式環境 release gate 仍缺少實際部署後驗證。
- ECPay-like adapter 仍明確回傳 pending，不能視為可用金流。

## 重複實作與 Dead Code

- Cloudflare direct upload/live input 有一般 API 與 admin ops API 兩組近似 route，雖共用部分 library，handler 邊界仍可再收斂。
- 公開 form 與 live page 各自 normalize registration fields，可能造成規則漂移。
- `src/components/interaction-role-form.tsx` 未被目前頁面引用；實際角色工作台使用 `interaction-roles-workbench.tsx`。
- `LEGACY_VENDOR_COOKIE` 只剩清除流程，未見新的設定或讀取用途。
- `prisma/migrations_sqlite_archive` 是歷史歸檔，不屬於現行 PostgreSQL deploy chain。

## 安全與資料風險

- `CRITICAL`：payment webhook 可由 request 選擇未知 provider，而 resolver 會回退至永遠驗簽成功的 demo adapter；production 必須拒絕 demo/unknown provider。
- `CRITICAL`：目前 `requireFinanceAdmin()` 同時允許商家 owner/admin/accountant 與 platform admin，但部分 `/admin/billing/**` 頁面與 actions 使用全平台 query，形成跨租戶財務操作風險。
- `CRITICAL`：商家 `/billing/payouts` 的 payment account query 未限制 `vendorId`，可能顯示其他商家的銀行資料。
- `HIGH`：商品 checkout URL 與互動 CTA URL 缺少安全 protocol 驗證，公開播放頁存在持久型惡意導向/XSS 風險。
- `HIGH`：部分 Live/Interaction relation connect 未先驗證關聯資源同屬目前 vendor。
- `HIGH`：未知 order webhook、退款紀錄與 commission negative adjustment 的唯一性/來源約束不足，仍有重複入帳與錯誤歸因風險。
- 多租戶資料多由 `requireVendor()` 後在 query 加入 `vendorId`；目前沒有資料庫 RLS 作第二層保護，新增 query 時容易漏掉租戶條件。
- `src/app/actions.ts` 集中大量跨領域 mutation，權限、交易與租戶條件的 review 成本偏高。
- 外部商城只能記錄 click；沒有外部訂單 API/Webhook 時，禁止把 click 推論成 confirmed conversion。
- 金流、退款、佣金與 payout 變更必須維持 provider event idempotency、append-only audit 與可對帳性。
- Production secrets 不得出現在 repo、報告、trace、screenshot 或 raw webhook 顯示中。

上述 critical/high 項目在修復與 regression test 通過前，專案不得標記為 production sellable。

## UI/UX 現況

- 共用 `PageHeader`、`Card`、`ButtonLink`、`Badge`、`EmptyState` 可沿用為後台基礎。
- 新版已具互動腳本範本、角色庫、直播發布預覽、商品 spotlight 與 CTA；較早 audit 的「完全缺失」描述已過時。
- 設計 token 仍只涵蓋基本背景、文字、邊框、藍色主色與橘色 CTA，缺少完整 semantic state 與 surface hierarchy。
- 少數頁面使用大圓角、漸層與重陰影，和高資訊密度後台語言不一致。
- 主要缺口是 focus-visible、aria-current/selected/live、reduced motion、行動版留言編輯器與完整 loading/error/success/disabled 狀態。
- 橘色 CTA 的白字對比需要重新驗證；成熟 SaaS 應以清楚狀態與資訊層級為主，不靠裝飾性漸層建立產品感。

## 測試與 Release 缺口

- 現有 Vitest 主要涵蓋 auth/security、PayUni/webhook、Cloudflare signature 與 retry/reconciliation；大多數 API route 缺少 route-level integration tests。
- Playwright 只有 1 個 smoke spec、7 個案例，尚未覆蓋完整商家 CRUD、billing、settlement、payout、affiliate 與跨角色隔離。
- 尚無 visual comparison、axe accessibility、Lighthouse、console/network assertion、coverage gate 與完整 viewport matrix。
- CI 尚未上傳 HTML report、trace、screenshot、video 等失敗 artifacts。
- 尚無 staging release workflow、環境保護、部署後 smoke、人工 approval 與 rollback gate。

## 產品需求缺口

- 完整商家 onboarding、註冊、邀請成員與多組織切換流程。
- 報名後通知、開播提醒、帳單與出款等事件驅動通知工作流。
- 真實訂單、庫存與外部商城成交確認能力；無 provider 訊號時只能保留 click attribution。
- 即時多人聊天室、moderation 與觀眾訊息持久化。
- 自動週期月結、銀行出款、發票開立與營運通知。
- 完整 tracking tag 注入、server-side conversion 與 attribution window 管理。

## 本輪不做的事

- 不連接正式金流、正式資料庫或正式寄信服務做破壞性驗證。
- 不推倒現有 UI 或重構核心產品模組。
- 不把外部 dashboard 尚未驗收的服務標記為 production ready。
