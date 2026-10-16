# 2026-09-24 Goal 規劃前檢查

本檔是規劃 evidence，並非產品驗收或部署證明。

## 本輪實測

- 工作目錄：`codex/one-stop-webinar-flow`；HEAD `60132971f60dbad83aae48ffa6f15d3f57682c6e`；原有 107 個 Git status entries。保留全部既有變更。
- `git fetch origin` 成功；`git ls-remote origin refs/heads/master` 與 GitHub ref API 均回傳 `a476ce34abdbb93d67b89a1abffa40496e1fdc0d`。
- `origin/master...HEAD` 為 130 / 553 commits。數量包含歷史與可能等效修改，不能當成待合功能數量。
- PR #210：`codex/one-stop-webinar-flow` → `master`，head `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e`，CONFLICTING / DIRTY，quality FAILURE。PR 回傳 baseRefOid 與 live master ref 不同，執行整合須重新讀取 live refs。
- PR #211：`codex/funnel-goal3-only` → `codex/one-stop-webinar-flow`。須盤點獨有功能與 patch 等效性。
- PR #1 是舊 AI Team smoke，不能只因使用者說「全部合」就視為產品交付內容。
- master branch protection：`enforce_admins=true`；實際 required check context 為 `quality`。
- `.github/workflows/ci.yml` 已在 push / pull_request 執行 ESLint、單元測試、coverage、browser gates 與 build，不需重建重複 workflow。
- HTTP GET staging `/` 與 `/api/health` 皆 200；僅保存狀態碼及長度，未保存 response body。此結果取代舊 503 診斷，但不能證明最新程式已部署或功能通過。
- `vercel.json` 設 `git.deploymentEnabled.master=false`。合併不等於部署；平台目前設定仍需在執行時核對。
- `vercel.staging.json` 的 buildCommand 先 migration 再 build，僅覆寫 DIRECT_URL。執行前须確認 DATABASE_URL 與 DIRECT_URL 同屬非 Production staging；不輸出值。
- `agy models` exit 0，發現 `claude-opus-4-6-thinking`。此結果只證明 discovery，複審另存 receipt。
- Codex usage 工具回報該週期已用 83%，剩 17%；缺少另一個視窗資料。4 小時是執行時間上限，不能保證剩餘額度能支撐。未兌換 reset credit。

## 既有紀錄，未在本輪重跑

`docs/ai-team/evidence/release-baseline-sandbox-20260922.md` 是多次追加的歷史紀錄。後段記錄 dirty worktree 全 E2E 154/154、DB concurrency 4,585/4,585、controlled production-mode build 通過，以及後續 targeted gates 通過。它们不是本輪 clean candidate 或 staging 的證明。

PayUni 外部 Sandbox closure 在既有紀錄仍 NOT_PROVEN。如今 health 已變更為 200，可在新 source lineage 確認後執行新的 bounded Sandbox 驗證，無須沿用歷史 no-rerun 禁令。

## 授權與範圍

使用者已同意本次相關修改整理、commit、受保護 PR merge 到 master、更新指定 staging，以及清理過時文件和不必要的非 Production 限制。PayUni 維持 Sandbox；不包含 Production 部署或真實金流。這一輪交付可執行 Plan；尚未啟動四小時實作 Goal。
