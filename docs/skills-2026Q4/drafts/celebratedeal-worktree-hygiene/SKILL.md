---
name: celebratedeal-worktree-hygiene
description: 建立、盤點、清理 git worktree 或分支，或在 Windows 上處理 node_modules junction／symlink、archive tag、未提交變更時使用；規範安全移除順序與不得丟棄變更的底線。
---

# CelebrateDeal Worktree 衛生

## 何時用
開新工作分支、新增或移除 worktree、清理舊分支、發現多個 session 同時工作、或準備刪除含 `node_modules` 連結的資料夾時。

## 必讀文件
- `AGENTS.md`「安全底線」與「Git」。
- `docs/review-2026Q4/20-dead-code-residue.md` §4（worktree 盤點與安全移除步驟）。
- `docs/handoff-codex-to-claude-20261017.md`「事故」段。

## 檢查清單
- [ ] 新工作一律 `git fetch origin` 後從 `origin/master` 開 `codex/*` 分支；不從其他舊分支或 `one-stop-webinar-flow` 起頭。
- [ ] 不在別的 session 的 worktree 內執行指令。
- [ ] 移除 worktree 前：`git -C <path> status --porcelain` 確認乾淨，或未提交內容已在 tag 內。
- [ ] **archive tag 先打再刪**：`git tag archive/…`＋推送，並用 `git ls-remote --tags origin 'refs/tags/archive/*'` 確認遠端有，才可移除 worktree 或刪分支。
- [ ] 檢查 `node_modules` 型態（PowerShell：`Get-Item <path>\node_modules -Force | Select LinkType, Target`）。若為 Junction／SymbolicLink，**先只拆連結**：`cmd /c rmdir "<path>\node_modules"`（不加 `/s`），再確認主目錄 `node_modules` 仍在；之後才 `git worktree remove`。
- [ ] `git worktree remove` 被未追蹤垃圾擋下時，確認內容已在 tag 或是垃圾、且 owner 同意後才用 `--force`。
- [ ] 移除後 `git worktree prune` 並 `git worktree list` 驗證；本機分支另一步決定，不與移除同步做。
- [ ] 有開放 PR 的分支（對應 worktree）不得移除。

## 禁止事項
- 不用 `reset --hard`、`clean -fd`、`stash`、`restore`、`checkout --` 丟棄不明變更。
- 不對 junction／symlink 用 `Remove-Item -Recurse` 或 `rm -rf`（會清空目標，曾造成事故）。
- 不 force push、不直推 `master`、不在 `master` 上直接工作。
- 不在未取得 owner 同意時刪除他人 session 的工作。

## 完成證據
`git worktree list` 前後輸出、tag 清單與遠端驗證結果、`node_modules` 型態判定、主目錄 `node_modules` 仍存在的確認；所有 git 寫入由主對話執行並記錄。
