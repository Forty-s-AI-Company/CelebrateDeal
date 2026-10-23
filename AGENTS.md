# CelebrateDeal Agent Rules

CelebrateDeal is a multi-tenant Next.js + Prisma (PostgreSQL) SaaS for live and webinar sales, with PayUni payments, affiliate commissions and LINE notifications.

## 回覆與風格

- 所有回覆使用自然的繁體中文。
- 修改 Next.js 程式前，先閱讀 `node_modules/next/dist/docs/` 中對應的文件。
- 直接推進使用者目標；只有安全、授權或無法驗證時才停下詢問。

## 安全底線

- 不讀取、輸出或傳送 `.env*`、密碼、Token、Cookie、私鑰、正式 Secret、正式客戶資料或付款資料。
- Production 部署、正式資料庫、正式付款／退款、正式寄信與其他不可逆的外部操作，需要使用者另外明確授權。
- 本機、Preview、staging、PayUni Sandbox 與可拋棄的 PostgreSQL（loopback 上的 `celebratedeal_*`）可直接用於開發驗證；使用合成資料。
- 不用 `reset`、`clean`、`stash`、`restore`、`checkout` 丟棄不明的變更。

## 程式碼

- 每個輸入 ID 都要在最後的 DB 操作綁定目前 vendor 的 ownership；金額只來自伺服器紀錄。
- Migration 只能往前；新增 model 或 migration 時同步登記到 `docs/codex-goal/PRISMA_INVARIANTS.md`。
- 付款、佣金、租戶權限與瀏覽器 QA 的領域規則見 `docs/domain-workflows.md`。

## 驗證與 Git

- 依風險跑 targeted tests、`npm run typecheck`、`npm run lint`；沒跑的測試不能說通過。
- 不降低 assertion 或 coverage 門檻，不用 skip 或假資料掩蓋失敗。
- 付款、checkout、退款、佣金、auth／權限或 migration 的變更，合併前需要一次獨立審查。
- 在 `ai/*` 分支工作（舊的 `codex/*` 分支沿用至合併完成），經 PR 合併；`master` 受保護，需 `quality` CI 通過並以 squash 合併。禁止 force push 與直推 `master`。

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
