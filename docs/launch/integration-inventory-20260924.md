# 2026-09-24 Git 整合盤點

本檔只記錄可重算的來源差異，不把歷史分支整棵樹視為應直接覆寫 master。

| 來源 | 比對 | 結果 |
|---|---|---|
| 新整合分支 | `origin/master` | 建立時同 SHA `a476ce34abdbb93d67b89a1abffa40496e1fdc0d`，原工作目錄未受影響 |
| PR #210 head | `origin/master` | 檔案樹差異 1,069 路徑；`src` 523（A 209、D 13、M 301），`prisma` 21，`docs` 376；不是可直接合入的審核範圍 |
| PR #211 head | `origin/master` | 檔案樹差異 964 路徑；`src` 520（A 192、D 46、M 282），須確認相對 #210 的獨有功能 |
| PR #210 merge preview | `git merge-tree --write-tree origin/master origin/codex/one-stop-webinar-flow` | exit 1，376 個衝突路徑（src 296、scripts 24、tests 18、docs 14、prisma 6、其餘 18）；沒有改寫任何工作目錄 |
| 原本本機工作目錄 | `codex/one-stop-webinar-flow` | 80 個 tracked diff、38 個 untracked（規劃文件加入前）；目前仍 dirty，禁止粗略 `git add .` |

`git log --right-only --cherry-pick` 在 squash/merge 歷史下仍回 553 個分支 commit；它不能證明 553 個獨有功能。下一步先以產品路徑、schema、測試與實際行為建立「master 已有／需移植／已被新實作取代」矩陣，優先 Auth、Funnel、checkout/order 與商家日常操作。

GitHub master CI run `35674751757` success，PR #210 的舊 `quality` 仍 failure。最終候選必須重新跑同一 candidate 的 gates，不能挪用 master 或 dirty tree 的舊結果。
