# 492 筆修改分批建議

基準：111 tracked modified、381 untracked、0 staged，共 492 個實際檔案。本次未 commit、未 stage、未重組。

| 建議順序 | 分組 | 檔案數 | 代表性檔案 | 目的／獨立驗證 | 是否先拆分／跨組依賴 |
|---:|---|---:|---|---|---|
| 1 | AI Team v5.2 | 35 | `.ai-team/mcp_server/server.py`、`.codex/config.toml`、`.agents/skills/ai-team-router/SKILL.md` | Orchestrator v5.2；可用 37 checkpoints 獨立驗證 | 先排除 `.ai-team/tmp/logs/reports`；與產品無依賴 |
| 2 | 測試 | 36 | `scripts/architecture-boundaries.test.ts`、`playwright.config.ts`、route/lib tests | 建立 Gate；可 targeted 驗證 | 必須和被測 product batch 對齊；Gate 弱化先修 |
| 3 | 認證與權限 | 24 | auth/MFA/password/security/tenant files | 安全與 session lifecycle | 與 schema、tests、email behavior 跨組 |
| 4 | 資料庫 | 9 | `prisma/schema.prisma`、3 migrations、DB safety scripts | 資料 invariants | 必須獨立 DB Review；不可混入 UI |
| 5 | 金流 | 37 | billing/payment/webhook/refund/payout/affiliate | 購買、退款、帳務 | 依賴資料庫與認證；sandbox evidence 另附 |
| 6 | 核心產品功能 | 23 | `src/app/actions.ts`、analytics/form/Cloudflare、package/CI | domain 與 API | `actions.ts` 先拆 vendor-member；CI/package 可再拆 |
| 7 | UI／UX | 21 | dashboard/live/login/components/globals.css | 頁面與錯誤狀態 | 依賴 API；需 Browser QA |
| 8 | 文件 | 38 | `docs/codex-goal/*`、quality reports、README | 決策、證據、SOP | 最後依實際 code/test 更新；避免先宣告完成 |
| 9 | 暫存或生成檔 | 266 | `reports/night-review/*`、cloud attempts、local module output | 歷史證據 | 不應直接全提交；保留 canonical summary，其餘 archive/ignore review |
| 10 | UNKNOWN | 3 | `.gitignore`、`eslint.config.mjs`、`tsconfig.strict-index.json` | repo/tool policy | 先逐檔 diff，分派到 AI Team／test／tooling |

## 建議 commit 邊界

1. AI Team runtime/config/docs（排除 runtime output）
2. 安全測試 Gate 修復
3. auth/authorization
4. migration 一支一 commit，附 DB Review
5. payment domain 分 checkout/webhook/refund/payout
6. core API/domain
7. UI
8. CI/tooling
9. canonical docs/evidence

## 不應直接提交

- `.ai-team/tmp/`
- `.ai-team/logs/`
- `.ai-team/reports/` 的 runtime raw output
- `coverage/`、`test-results/`、`playwright-report/`
- 大量 `reports/night-review/*/cloud-attempts` 與重複 module raw output，除非先定義 archive policy
- 任何含秘密、正式資料、登入狀態、cookie 或個人 session 的檔案

## 風險

- 266 個暫存／生成檔掩蓋真實 product diff。
- 兩個未追蹤 candidate migrations 不得跟一般功能一起 commit。
- 目前 Gate 雖綠，但 architecture ceiling 與 migration count 曾被放寬；必須先恢復治理語意。

## 2026-07-28 實際批次結果

- 原始快照為 502 筆、0 staged；外部安全備份位於 `C:\Users\eden\Downloads\AI-Team-Migration-Backups\CelebrateDeal-git-batching-20260728-130341`。
- 已提交 `725c17a docs(launch): record verification evidence`（4 檔）與 `893865c docs(launch): record change batching outcome`（含原始 snapshot 的 change-batch plan）。
- 其餘 497 筆原始變更均已分類且保留在工作區：291 筆 historical/raw reports 為 archive-or-ignore candidate；26 筆 AI Team、7 筆 DB、71 筆產品、58 筆測試、12 筆 tooling/CI、33 筆文件皆為 needs-review。
- AI Team candidate 的 MCP unit test 有 route expectation mismatch；本次不修程式、不強行提交。DB、payment、UI 與測試的混合檔案也沒有 stage。
- 完整報告：`.ai-team/reports/git-change-batching-20260728-133000/`。
