# WP-20 造訪準備紀錄

此分項記錄瀏覽器已啟動的邏輯造訪，在 prepare 回應離開伺服器前提交持久期待來源，之後由同一 visitor／event 的實際造訪核對。準備紀錄不是一次成功造訪，也不證明所有公開頁都執行了 JavaScript；完整 visits coverage producer 尚未完成。

## 寫入與重試

client 的同一 driver 在 prepare 與 visit 使用同一個 event UUID，重送也不換 ID。prepare 在原有交易中先解析公開頁當前內容版本、建立或驗證第一方 visitor，再提交 `LiveMetricVisitIntent`。HTTP 不接受 client 指定 visitor、version 或時間。回應只有既有版本與狀態；身份憑證仍由 HttpOnly cookie 管理。

公開 `prepareTrackedMetricVisit` 必填事件，collect 必須先找到相同 vendor／live／version／visitor／event 的 intent，才在同一筆交易記錄造訪。事件 UUID 在入口統一轉小寫，大小寫重送不新增另一筆事實。內部 legacy collector 保留既有契約，不能因為能寫入而被當成新協定的完整來源。未更新的 client 缺少 prepare eventId 會收到 400；本分項沒有部署。

scope／event 主鍵禁止不同 visitor 接管事件。遺失 prepare 回應且未保留身份時，後續新身份不能接管該事件；舊紀錄會保持 unmatched。遺失已寫入造訪的回應時，保留身份與 event 的重試不重複計數。

已知事件衝突或缺少 intent 使用固定 scope-unavailable／HTTP 404，client 不重試；資料庫暫時故障仍為 503。prepare 解析後逾時可以沿用同一事件重試；已收到匹配的有效 visit 回執，即使計時器剛好到期也保留 recorded。不得換事件 ID 來把舊 unmatched 消除或宣稱完整。

## 資料保護

123 migration 不回填歷史、不建立正向 coverage，也不修改付款、報名或觀看事實。準備時間由 DB 在毫秒精度下產生。紀錄不可更新、直接刪除或 truncate；刪除 visitor 不能抹去期待來源，刪除所屬 version／vendor 才一起 cascade。RLS 開啟，PUBLIC 與已知 API roles 無權存取，非 owner 的意外 ACL 使 migration 失敗。

每個請求沿用現有 origin、限流、1024-byte body、private/no-store 與 10 秒交易／5 秒 statement 界線。紀錄只存 scope、隨機身份／事件識別字與時間，不存姓名、Email、網址或憑證。

## 驗證範圍與後續

`scripts/wp20-visit-intent-disposable.mjs` 自建並清理 owned loopback PostgreSQL，驗證 migration／schema、並發去重、身份與 scope 拒絕、回滾、實際 visit 重送、unmatched 保留、非 UTC DB 時間、immutable／RLS／ACL 與 vendor cascade。單元測試另涵蓋 client／HTTP／同交易 composition；這些不等於完整 HTTP→真實部署資料庫的驗證。

後續必須實作完整頁面入口的持久期待來源、來源全集與遺失對帳、revision／proof／atomic fence／reader 綁定。prepare 從未抵達伺服器、JavaScript 未啟動、歷史 legacy 及 runtime／部署角色仍不能標 complete。目前這份紀錄只能讓已觀察的中途遺失不被當作已成功造訪，不能以「沒有 unmatched」推論不存在遺漏。

## 回滾

停止新 client／API intent 入口，依精確 manifest 反向程式 patch；保留已建立的期待紀錄與來源，不刪除或回填成成功。只在自建 disposable DB 驗證 migration；不對既有或正式 DB 套用、逆向或刪表。此分項不推送、不部署。
