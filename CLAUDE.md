@AGENTS.md

## Claude 團隊分工

主對話負責判斷難度、拆解任務、整合結果與最後決定，並自行決定每個子代理的模型與努力程度。

主對話在 Fable 上執行時不寫程式：所有程式修改都派給 `engineer-hard` 或 `engineer`。Opus 與 Sonnet 都解決不了時，先通知使用者，經同意才交給 Fable。文件、設定與 git 操作可在主對話完成。

| 子代理 | 模型 | 何時使用 |
|---|---|---|
| `engineer-hard` | Opus, high | 付款、checkout、退款、佣金、auth／權限、租戶邊界、migration、併發、大型重構 |
| `engineer` | Sonnet, medium | 一般功能、UI、非金流 API、修 bug、補測試 |
| `reviewer` | Opus, high | 上述高風險變更合併前的獨立審查；只回報 findings，不改程式 |
| `docs` | Haiku, low | 文件、PR 描述、整理清單與測試輸出 |

派工時給子代理明確的目標、檔案範圍、完成標準與分支；同一時間每個檔案只有一個 writer。主對話負責推送與開 PR，並親自檢查子代理的結果再回報。

## Worktree 清理

子代理的 worktree（`.claude/worktrees/agent-*`）各帶約 1 GB 的 `node_modules` 與 `.next`，不清理會很快塞滿 C 槽。

- PR 合併（或確認放棄）後，主對話在同一輪回報前移除對應 worktree，不留到之後。
- 只刪同時符合以下條件的 worktree：PR 已 MERGED、`git status` 乾淨（忽略 `AGENTS.md`）、沒有 PR 之後才加的 commit、未 locked、近 90 分鐘內沒有檔案變動。
- 不動：進行中或之後會用到的 worktree，包含 PR 仍 OPEN、沒有 PR、有未提交修改、有未推送 commit、locked，以及不確定是否有其他 session 在用的。這些交給使用者決定。
- 刪除前先用 `[IO.Directory]::Delete(<path>\node_modules, $false)` 斷開 `node_modules` junction，再 `git worktree remove --force <path>`，最後 `git worktree prune`。不可直接遞迴刪除含 junction 的資料夾，否則會連主目錄的 `node_modules` 一起刪掉。
- 派工時能用 junction 指向主目錄 `node_modules` 就用，避免每個 worktree 各自 `npm ci`。
- 一次派很多子代理後（或 C 槽剩餘低於 30 GB 時），重新檢查一次 `git worktree list`。

領域技能在 `.claude/skills/celebratedeal-*`。
