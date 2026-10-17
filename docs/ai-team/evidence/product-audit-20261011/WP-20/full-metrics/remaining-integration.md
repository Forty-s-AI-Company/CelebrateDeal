# WP-20 已核准的後續整合

狀態：IN_PROGRESS，未因授權阻擋；M-1/M-2 已獲本次「核准」。本文件不縮減整包 WP-20。

## 尚未完成
- 將伺服器驗證後的報名識別連接到統計 session；沿用 form-submission-chat-session 的驗證與同租戶查詢，不能相信 client personId。
- 伺服器建立不可變影片版本與長度。未知時長維持不可計算；直播與重播分開。
- 新增 additive 資料表與 migration：版本、第一方訪客、驗證報名歸屬、統計 session 與區間；tenant/live/version 複合外鍵，去重 sequence，不改發布或付款條件。
- 保存來源起始時間／資料完整性資訊。歷史沒有收集的區間不可把空查詢當已知零；遺失 sequence、過期視窗、未收尾 session 必須明示不完整。
- 在播放元件接上 samples；seek/pause/waiting/ratechange 換 anchor。小批次送出，API 驗 active admission／同租戶已驗證報名／版本、單調 seq、有限時間範圍與大小；相同 seq 重送冪等，衝突內容拒絕。
- 報名頁先記第一方匿名瀏覽器，再於驗證 callback 連接；不以觀看頁 page_view 代替報名分母。
- 由保存資料建置 read model adapter、唯讀訂單歸屬，接回五項指標 UI（視窗、時區、分母、不可計算原因、暫定標示）。目前兩個純計算模組尚未接入頁面或 DB。
- disposable PostgreSQL 跑 migration/rollback、租戶隔離及重送測試；Chromium/Firefox 測 seek、pause、buffer、倍速及同人多 session；合格 Auth/Permission/Migration 獨立深度審查與整包 acceptance。

## 不需重新核准的執行範圍
本機／Preview／staging／固定 Sandbox 和合成資料的實作、驗證、複審已核准。只在獨立 worktree 寫入，不推送、不部署 Production。正式保存期限及 D-5 法律告知仍延後，不影響 isolated synthetic implementation；測試資料由 teardown 清除，正式收集保持關閉。

## 已建立的計算契約
毫秒是整數；首次完看取首次可觀測的整數毫秒，向上取整。區間裁切使用 BigInt 有理數，介面只在顯示時四捨五入。下單仍是成立未取消，絕不推定付款。後續 ingestion 與 read adapter 必須共用 live-viewing-evidence.ts，避免兩套時間規則。
