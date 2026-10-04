# 分支整合最新進度

2026-10-04。整體 Goal：進行中。

## 合併進度

- #351：已合入 master `40db1781`，付款 token 修正、正式 probe 改為手動、獨立審查及新 head CI 通過。
- #352：已合入 master `fc28e1b8`，回收 #211 的三份 Funnel 回歸測試及 #13/#353 商品預覽修正；新 head CI 與 canonical gate 通過。
- #353：兩份產品檔案已透過 #352 完整交付，原 PR 關閉保留追溯。
- #354：已於 `2026-10-04T14:26:55Z` 合入 master `42bce600e9c6b88003bd3b2a924d0ea96c70aee8`，交付 LINE 圖文選單草稿。PR CI `37207666809`、push CI `37207662788` 全數通過，canonical gate READY、0 blockers；master tree 與已驗收 head `23fcae98` 完全一致。
- #210、#211：保留開啟，其餘產品功能與原有 dirty 工作尚未全部整合。

## #354 已驗證範圍

草稿支援 6/4 格範本、預覽、建立、載入、修改、刪除。讀寫限制 owner/tenant，CSRF 與 ID/revision CAS 防止跨店家、過期分頁及刪除重建 ABA。新增表启用 RLS 且無公開 policies。

本機 42 targeted unit/SSR、3 PostgreSQL 真實測試及新增完整 Playwright 旅程通過；完整重跑 583 個 Vitest 檔案／4,210 tests、1,063 Node contracts 全部通過，未 skip。Coverage statements 64.78%、branches 63.54%、functions 68.28%、lines 70.33%；global 與 src/lib 門檻通過。82 migrations fresh deploy 及 task-owned container/temp cleanup 通過。獨立 Critical review 及三次增量 review 無未結 findings。

CI 原失敗為新增 migration 後歷史 runner/inventory 測試的固定清單未同步。已補精確數量和名稱，保留歷史 runner 的原授權來源範圍。Windows 本機證據檔 CRLF 的 hash 差異已比對 Git blob 修正，Git 文件內容未改動。

## 歷史分支處置與原檔保留

初始待核對 42 個歷史 head，14 個已逐檔確認原意圖由 master 完整保留或替代，剩餘 28 個：Funnel 5、AI Team 2、Sandbox QA 19、staging 2。這些是來源 head 計數，不等於功能數；內容替代不冒稱原 SHA 已合入，也未刪除原分支。

原工作目錄 HEAD `60132971`、120 筆原 dirty 狀態及 118 個可核對檔案雜湊完整保留。與 master 比對後，44 檔內容已在主線、62 檔仍不同、12 檔主線不存在、2 筆為刪除／未雜湊。後續依三方差異逐段整合。

## 下一段與未完成工作

1. #354 合併及 master tree 核對已完成；將本輪最新盤點與驗收證據納入下一個受保護文件交付。
2. #211 舊 Puck CSS import 已確認由現行套件 runtime 自動注入替代，不需補匯入；舊 inventory snapshot migration 與主線較晚時間戳 migration 完全相同，不重複套用。PR #355 已補回表單同步送出鎖、一頁式網站導覽及公開表單指定場次；26 個 targeted tests 與表單重試 browser 通過，等待最終 head CI 及驗收後合併。
3. #210 LINE 外部同步仍缺發布序列化、provider/DB 補償及學員入口解析，介面明確未開放；student portal、affiliate/commission、成長與私訊功能待逐段核對。
4. 原 dirty 中 password-reset smoke 的正式環境限制、Funnel、AI Team 路由／驗證差異需繼續審查；不能直接覆蓋較新的 master。
5. Sandbox QA 共用 runner/設定、provider binding attestation 與其餘歷史差異詳見未來處理報告。

完整來源、雜湊與逐 head 處置：`branch-integration-deferred-work-20261004.json`。未來工作與歷史操作紀錄：`branch-integration-future-work.md`。本輪未部署 Production、未操作正式 DB、未呼叫真實 LINE 或付款／退款服務。
