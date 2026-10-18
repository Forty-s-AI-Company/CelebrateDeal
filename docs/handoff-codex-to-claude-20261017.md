# Codex → Claude 交接紀錄（2026-10-17）

本文件記錄交接當天實際做了什麼與仍待處理的事項；不是任何功能的驗收證據。

## 分支整合

- 盤點本機 307 個分支、遠端 348 個分支與 126 個 worktree，逐一以 ancestor、patch-id、檔案內容與 PR 合併 head 判定是否已在 `master`。清單與判定依據見 `docs/branch-cleanup-20261017.md`，刪除前的所有 ref SHA 見 `docs/branch-refs-backup-20261017.txt`。
- 已整合的 319 個遠端分支與其本機分支已刪除。
- 未整合但已被 `master` 取代的 25 個遠端分支與 27 個本機專屬分支，先建立並推送 `archive/branch/*`、`archive/local/*` tag 再刪除；可隨時從 tag 還原。
- 25 個 worktree 的未提交內容以暫時 index 快照成 `archive/wip/*-20261017` tag 並推送，worktree 本身未修改。推送前逐一 secret scan；`product-audit-goal-plan` 與 `staging-migration-apply-gate` 的掃描命中經人工確認為 loopback／unreachable／example 佔位 URL，並排除了誤建的 `%SystemDrive%` Windows 快取資料夾。

## 功能分支去向

| 來源 | 去向 | 狀態 |
|---|---|---|
| `codex/post-purchase-commerce-20261007` | 只移植 5 個功能 commit 到 #423；後段 PayUni Sandbox 工具已由 #407–#422 取代 | 本機 typecheck／lint／unit／contracts／secret scan 通過，等 CI 與獨立審查 |
| `codex/server-tracking-webhooks-20261007`（#384） | 另開 `codex/server-tracking-sync-20261017`（#424）合併 master | 本機驗證通過；真實 Meta Test Events 送達未驗證，功能預設關閉 |
| `codex/notifications-main-20261011`（#420） | Codex worktree 內已有本機 merge commit `da2de930`，未推送 | 推送到 Codex 擁有的分支被權限擋下；四渠道真實送達仍待外部測試帳號 |

#423 與 #424 都把 migration inventory 計數調到 96；後合併的一個需要再調整。

## Codex 最新未提交工作

`product-audit-goal-plan`（基於 `efb8b7e9`）是 Codex 最後的 Goal：產品稽核 20 個 WP，Codex 於 2026-10-16 記錄 14/20 完成，其餘 6 個（WP-04、13、14、16、17、18）需要固定隔離的非 Production scheduler 與 LINE provider。內容保存在 `archive/wip/product-audit-goal-plan-20261017`，尚未整理成 PR。

## 事故

移除部分 Codex worktree 時，它們指向主目錄 `node_modules` 的 NTFS junction 被 git 一併清空了目標內容；已以 `npm ci` 重新安裝。之後移除 worktree 前要先拆 junction。
