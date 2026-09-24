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

## 產品路徑初步矩陣

下表只比較 `src/` 的路徑名稱，尚未完成行為等效 review。欄位依序為 master／PR #210／PR #211 的檔案數；同名不代表內容相同。

| 關鍵字 | master | #210 | #211 | 初步決策 |
|---|---:|---:|---:|---|
| `student-portal` | 2 | 8 | 8 | 需檢查學員入口、schema、權限與既有 master 替代實作 |
| `line-rich-menu` | 0 | 5 | 5 | 舊分支獨有，含 LINE 外部 API；需獨立整合與測試 |
| `affiliate-portal` | 0 | 13 | 13 | 舊分支獨有，含租戶與帳務風險；需獨立整合與審查 |
| `funnel-commerce` | 6 | 7 | 7 | master 已有核心，需比對差異與訂單行為 |
| `funnel-operations` | 6 | 6 | 0 | #211 會移除 master 的營運模組，不能直接以其整棵樹覆蓋 |
| `wp4-payuni-buyer` | 0 | 9 | 9 | 舊分支獨有，僅在固定 Sandbox 流程評估，不能直接帶入正式路徑 |
| `consultation-booking` | 3 | 3 | 3 | 路徑已有，仍需內容比對 |

本輪先修可重現的 Funnel 名單感謝頁缺陷，再按核心使用路徑與資料/權限風險選擇下一個垂直切片。上述未整合項目保持待驗證，不以文件標成完成。
