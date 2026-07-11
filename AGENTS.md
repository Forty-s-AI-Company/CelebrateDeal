# CelebrateDeal Agent Rules

## 產品背景

CelebrateDeal（賀成交 AI）是 Cloudflare-first 的多租戶直播導購 SaaS，涵蓋預錄直播、報名、商品 CTA、官方互動角色、聯盟歸因、佣金、計費、月結與批次出款。只能參考競品公開流程，不得複製私有程式、素材、商標或文案。

## 技術棧

- Next.js 16 App Router、React 19、TypeScript、Tailwind CSS 4。
- Prisma 6 + PostgreSQL；正式規劃為 Supabase PostgreSQL。
- Vitest、Playwright、GitHub Actions。
- Cloudflare Stream、PayUni adapter、Resend、Sentry、PostHog、Upstash/WAF。

Next.js 16 可能與既有知識不同。修改 Next.js 程式前，先閱讀 `node_modules/next/dist/docs/` 中與工作直接相關的文件，並遵守 deprecation 訊息。

## 目錄責任

- `src/app/(app)`: 商家登入後頁面；所有 query/mutation 必須限制目前 vendor。
- `src/app/admin`: 平台管理端；平台級財務操作只允許 platform admin。
- `src/app/api`: route handler、webhook、job 與外部服務入口。
- `src/components`: 共用 UI 與領域元件，不在頁面複製同一套互動。
- `src/lib`: auth、billing、payment、Cloudflare、security 與可測試領域邏輯。
- `prisma`: PostgreSQL schema、migration 與可重複 seed。
- `tests`: E2E、integration、security、visual 與 fixtures。
- `.agents/skills`: 專案與外部 Skills；先讀 `SKILL.md` 再使用。
- `.codex/agents`: 專案子代理設定。
- `automation`: 無人值守 orchestrator；禁止正式部署與不可逆操作。
- `docs`: 產品、設計、QA、上線與治理的可稽核文件。

## 命名與程式規範

- TypeScript 禁止新增明確 `any`、忽略型別錯誤或吞掉例外。
- 元件用 PascalCase；函式與變數用 camelCase；DB 欄位沿用既有 Prisma 命名。
- Route、action 與 service 的輸入先經 Zod 或明確 schema 驗證。
- URL 只允許明確支援的 `https:`/安全內部路徑，不接受 `javascript:`、`data:`、`file:` 或 protocol-relative URL。
- 註解只說明非顯而易見的限制、交易邊界或安全原因。
- 不做無關重構，不還原他人變更，不刪測試換取綠燈。

## 多租戶與權限

- 每個 vendor-owned query、update、delete、relation connect 都必須帶入並驗證目前 `vendorId`。
- 不信任表單中的 vendorId、userId、price、commission rate、role 或 resource ID。
- 跨模型 relation 必須先確認兩端屬於同一 vendor。
- 商家角色不得讀取或操作其他 vendor 的 settlement、payout、payment account、webhook 或 audit log。
- 平台管理、組織 owner、講師/上線、推廣者/下線、工作人員與訪客的權限要以 deny-by-default 定義。
- 沒有 PostgreSQL RLS 時，應用層隔離測試是 release blocker；RLS 上線後仍保留應用層 guard。

## 金流、歸因與分潤

- Client amount、vendor、referralCode 與 commission rate 都不是真相來源；以 server-side product、pending transaction 與 attribution record 為準。
- 未知 payment provider、未知 order 或無效 signature 必須拒絕。Demo provider 只能在 development/test 使用。
- Provider event、退款、佣金 adjustment、settlement 與 payout 都必須冪等、可對帳、可稽核。
- Locked settlement 不可直接改寫；使用 append-only adjustment 或下一期沖銷。
- 外部商城 click 只代表 click。沒有訂單 API、webhook 或人工對帳證據時，不得標成成交。
- 商品連結替換順序為有效推廣者連結、上線設定、商品預設連結；每個 URL 均需安全驗證與歸因期限檢查。

## UI/UX

- 後台採成熟、高資訊密度、克制的 SaaS 介面；不要用行銷 hero 取代工作流程。
- 使用 design tokens 與共用元件，避免每頁自訂色彩、圓角與陰影。
- 橘/金/紅只用於成交、成功與高優先 CTA；confetti 只在真實成交完成時出現。
- 禁止無理由的紫藍漸層、發光球、玻璃擬態、巨大圓角、卡片套卡片與裝飾性動畫。
- 每頁只有一個主要動作；表格具搜尋、篩選、分頁與清楚狀態。
- 完成 empty/loading/error/success/disabled/hover/focus-visible，支援鍵盤、ARIA 與 `prefers-reduced-motion`。
- 行動版重新安排工作流，不只是縮小桌面版。

## 子代理規則

- 複雜盤點、跨領域 review、測試矩陣或三個以上獨立問題必須使用子代理。
- 讀取型工作可平行，最多 6 threads；`agents.max_depth = 1`。
- 寫入型代理最多同時 2 個，必須有互斥的明確檔案 ownership。
- 同一檔案、同一 schema、同一 payment flow 不可平行修改。
- 主代理必須等待、審查並整合代理成果；不得把未驗證摘要直接當完成。

## 禁止操作

- 不執行 `git reset --hard`、force push、破壞歷史或自動部署 production。
- 不提交 `.env`、cookies、token、HashKey/HashIV、stream key、DSN、raw 個資或正式 webhook payload。
- 不對正式金流、正式資料庫、正式寄信或真實顧客資料做破壞性測試。
- 不自動合併重大 security、database migration、payment、settlement 或 payout 變更。
- 不因缺少外部憑證而停工；完成 mock、adapter、fixture、錯誤狀態與 runbook，並標記 `External required`。

## 驗證命令

依變更風險執行，完整 release gate 為：

```powershell
npm run db:generate
npm run lint
npm run typecheck
npm run test
npm run build
npm run preflight
npm run e2e:smoke
```

資料模型變更另跑 `npm run db:migrate:status`；UI 變更另跑 visual/a11y；外部 adapter 使用 sandbox fixtures，不使用正式 credentials。

## Definition of Done

- 行為、資料隔離、錯誤狀態、稽核與 rollback 已定義。
- 新增或修改的高風險行為有 unit/integration/E2E 或 security regression test。
- lint、typecheck、tests、build 與適用 gate 通過，失敗 artifact 可追溯。
- 文件、env example、migration/runbook 與 `BLOCKERS.md` 和程式一致。
- 沒有 secret、明確 `any`、被跳過的安全檢查或以 click 冒充 conversion。
- 外部 dashboard 尚未驗收者明確標記 `External required`，不可宣稱 production ready。

## 執行與回報

- 先檢查再執行；不可停在計畫階段，也不可每完成小步就要求使用者回覆「繼續」。
- 合理假設寫入 `docs/ai-team/ASSUMPTIONS.md`；只有付費、人機驗證、私人帳密、正式資料、不可逆操作或法律決策可列 Hard Blocker。
- 每次完成回報必須包含：目標、實際完成、修改檔案、測試證據、安全/效能/可讀性/可維護性審查、Assumptions、External required、Hard Blockers、下一輪可複製 Prompt、建議模型與推理程度。
