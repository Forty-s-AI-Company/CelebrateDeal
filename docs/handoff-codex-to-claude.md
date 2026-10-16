# Codex → Claude 交接文件

建立日期：2026-10-17。本文件只記錄交接當下的盤點，不是驗收證據；未執行的驗證不得視為 PASS。

## 目前狀態

- 工作分支：`codex/one-stop-webinar-flow`（base：`master`）
- 最近 commit：`60132971 docs(integration): record master merge and remaining browser blockers`
- 未提交變更：約 275 項（82 個已追蹤檔案修改／刪除，其餘為 untracked）。尚未建立交接 checkpoint。
- 主要變更區域：
  - `.ai-team/`（scripts 約 16、mcp_server 約 9、config 約 7）— AI Team vNext routing 重構
  - `.agents/skills/`、`.codex/` — Codex adapter 與 agent descriptor
  - `docs/ai-team/`、`docs/launch/`、`docs/ai-team-vnext-plan.md`
  - `tests/e2e`（約 13）、`src/app`、`src/lib`、`src/components`
  - 設定：`package.json`、`next.config.ts`、`playwright.config.ts`、`eslint.config.mjs`、`tsconfig.json`、`.github/workflows/ci.yml`、`.gitignore`
  - 已刪除：`scripts/validate-non-production-owner-authorization.{mjs,test.mjs}`

## AI 文件對照

| 路徑 | 性質 | Claude 接手方式 |
|---|---|---|
| `AGENTS.md`（`CLAUDE.md` 以 `@AGENTS.md` 引用） | 專案規則，工具中立 | 繼續遵守；安全底線、驗證規則照舊 |
| `.ai-team/config/routing-policy.json` + `routing.py` | Routing 唯一來源 | 不修改、不複製；Claude 不依賴它選模型 |
| `.agents/skills/*`、`.codex/agents/*`、`.codex/config.toml` | Codex 專屬 adapter | 保留；Claude 不讀取，不刪除 |
| `docs/ai-team/*`、`docs/ai-team-vnext-plan.md` | 流程與 handoff schema | 當參考；handoff 紀錄欄位可沿用 |
| `docs/launch/manual-blockers.md` 等 | 發版 blocker 與 owner 動作 | 真正的待辦來源，見下 |

## 待辦與 blocker（摘自 `docs/launch/manual-blockers.md`）

RELEASE_CRITICAL 仍開啟：MB-03（migration／legacy rows 盤點）、MB-04（Supabase ACL／RLS）、MB-05（PayUni Sandbox 設定）、MB-09（金流對帳 evidence）。MB-10 為 CAT10 責任與 GO/HOLD/NO_GO 決策。這些多半需 owner 或 provider 動作。

## Claude 接手時的注意事項

1. 不讀取或輸出 `.env*`、Secret、正式資料；Production 部署、正式 DB、付款、寄信仍需另行授權。
2. 不使用 `reset`/`clean`/`stash`/`restore`/`checkout`/`rebase` 丟棄未知變更。
3. 不降低 assertion 或 coverage 門檻；未跑的測試記為未執行。
4. 修改 Next.js 前先讀 `node_modules/next/dist/docs/`。
5. 推送僅限 `codex/*` 並走 protected PR；禁止 force push 與直推 `master`。
6. Codex 的 agent/MCP 派工流程不自動啟用；除非使用者指示，Claude 以單一主代理工作。

## 接手基線（2026-10-17，未提交工作樹）

| 檢查 | 結果 |
|---|---|
| `npm run typecheck` | PASS（0 error） |
| `npm run lint` | PASS（0 error、5 warning：`upsell-offer.tsx` 的 `window.location.assign` ×2、`landing-page-puck-config.tsx` 的 `<img>` ×3） |
| `npm test` | FAIL：11 檔／78 個測試失敗，4460 通過，40 略過 |

失敗分三類：

1. **本機測試 DB schema 落後（約 76 個）**：`Affiliate.userId`、`RegistrationForm.pageBlocks`、`AffiliateCommission.currency` 欄位不存在。影響 `payment-webhooks`、`*.db.test.ts` 等。判斷為本機 DB 未套用最新 migration，不是程式錯誤；需先確認目標是 disposable DB，再套 migration 重跑。
2. **`scripts/repository-hygiene.test.ts`**：讀取已刪除但尚未從 git index 移除的 `scripts/validate-non-production-owner-authorization.test.mjs`。屬未提交刪除造成，checkpoint commit 後應會消失。
3. **`src/lib/student-portal-auth.test.ts`**：測試用固定時間 `2026-09-09` 建立 session token，但驗證時使用真實時鐘，token 已過期而被導向登入頁。屬測試時間炸彈，需改用 fake timers 或把 `now` 傳入驗證。

### 處置結果

- Checkpoint：`f3f1f96a`（Codex 未提交工作）、`8e22be51`（交接文件與測試修正），僅本機，未推送。`npm run secret:scan` 於提交前 PASS（涵蓋 untracked）。
- 類別 1：本機 `celebratedeal_test` 的 migration 歷史與本分支分歧（本分支 12 個未套用；DB 另有 5 個其他分支的 migration）。未重設該 DB。改以已與本分支 87 個 migration 一致的 `celebratedeal_e2e` 重跑 9 個受影響檔案：88/88 PASS。
- 類別 2：checkpoint 後 `repository-hygiene.test.ts` 4/4 PASS。
- 類別 3：在該測試固定時鐘後 7/7 PASS。
- 尚未在 checkpoint 後重跑完整 `npm test`。

### 待決事項

`celebratedeal_test` 需要對齊本分支 schema 才能讓預設 `npm test` 全綠。方式擇一：重建該 DB 後 `prisma migrate deploy`（會影響其他分支共用此 DB 的工作），或執行測試時以 `DATABASE_URL` 指向 `celebratedeal_e2e`。

## 建議下一步

依 blocker 與 `docs/launch/next-work-packages.md` 決定下一個工作包。
