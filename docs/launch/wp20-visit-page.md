# WP-20 公開頁期待來源

此分項讓 `/live/[slug]` 在將追蹤識別字交給瀏覽器之前，先提交未計數的頁面期待紀錄。它補上 JavaScript 尚未啟動／prepare 尚未抵達的可觀察缺口，不把伺服器 render、預載或期待紀錄直接計為造訪。完整 visits coverage producer 與完整 WP-20 尚未完成。

## 頁面到造訪的核對

公開頁先等待 Next.js `connection()` 的 request-time 界線，保留原有公開頁、runtime 與發布就緒檢查。只有既有 metric 設定可用且 runtime 非 unavailable 時，才呼叫 `issueMetricVisitPage`。該服務在有界交易內解析已啟用的當前版本、寫入 DB 時間與版本生命週期下的隨機 event UUID、重新核對 context 與未到期的期待紀錄，提交後才回傳 eventId。它不建立版本或啟用收集。

collector 使用該 eventId，driver 重試不換識別字。公開 `prepareTrackedMetricVisit` 在配置 visitor 之前，必須核對同 vendor／live／current version／event 的未到期 page；之後才寫入既有 visitor-bound intent。公開 collect 仍要核對精確 visitor intent 才同交易記錄造訪。未知或其他 scope／version 的 page 不能被用來配置身份。page 與 intent 以完整 scope／event 關聯；此分項沒有新增兩表間 FK，也不因此推論正向 coverage。

metric 版本未配置時保留原本頁面，沒有 collector／nonce。意外資料庫或 commit 失敗不能回傳識別字或默默略過追蹤錯誤。頁面讀取本身失敗時沿用錯誤流程，不透過 client 亂造 event 來補。

## 預載、快取與缺漏

本機 Next.js 文件提醒 render 可能由預載觸發，所以期待紀錄一律未計數。render 被取消、回應遺失、未執行 JavaScript 或未回答的預載保留 unmatched，不自動排除或當作成功。React render 重試可能產生額外未回答期待來源；這是保守 unknown，不是額外造訪數。

此機制不證明所有公開 URL／CDN／瀏覽器返回快取都經過新 renderer。舊快取共享的 nonce 不能讓第二個身份接管；缺漏仍未知。沒有建立「全站完整收集」epoch，也沒有回填舊資料。後續 producer 必須核對 page→intent→visit、跨期間／晚抵達／缺失、權威可見性與 revision/proof/fence/reader，不能從「有 page 紀錄」或「沒有 unmatched」直接認證 complete。

## 資料與驗證界線

124 migration 只新增 scope／隨機 event／issuedAt／expiresAt，不含人名、Email、網址或憑證。DB 強制 ReadCommitted、版本與收集生命週期及不可變 server timestamp；禁止直接更新、刪除、truncate，所屬 version／vendor cascade 才可清除。RLS 與 owner-only ACL fail closed，未授權角色不能讀取。瀏覽器身份仍由原 HttpOnly 機制處理。

每個版本最多 10,000 筆 page 期待紀錄。issuer 在解析 context 前取得同場次 advisory transaction lock，DB trigger 用相同 key 再核對上限，並發不能突破最後名額。滿額時只允許在第一筆既有紀錄將 `lossAt` 從 null 改成 DB 時間一次，提交後才讓公開頁繼續以沒有 collector 的狀態顯示。這個永久缺漏標記不可清除／改時，也不刪舊期待騰空間；後續 producer 必須將標記後的來源視為未知，不能因沒有新增 page 而宣稱零造訪。上限限制這個新增表的儲存成長，不等於已驗證 HTTP 防洪、連線容量或正式負載。

版本在 context 解析與 INSERT 之間到期，使用專用 SQLSTATE `P2090` 回傳無 collector 的 unavailable 狀態；不把其他完整性或資料庫故障吞成相同結果。最終 lookup 的到期狀態也區分處理。

同場次 issuer 會序列執行，statement／交易／取得交易連線上限分別為 5／10／5 秒。只驗證了 8 個並發請求搶最後名額；持續高流量、連線池跨場次影響及容量預算未驗證。鎖或 DB 故障維持 fail closed，不能為了顯示頁面而回傳無法持久標記的未追蹤成功。已滿額後重複取得首列鎖的最佳化也尚未處理，這些不標示為負載驗收通過。

10,000 是目前本機協定的硬上限，正常流量或匿名請求也能用盡，之後該版本不再產生新 collector。這是尚未解除的收集可用性限制，不是上線容量認證；後續需在保留缺漏證據下補入口限流或可審查的期待來源彙總。不可透過刪除未知來源或無痕重設名額解除限制。

未來 reader 必須將**任何 page row 的非空 lossAt**視為整個版本從最早 lossAt 起的缺漏，不限於首列、未匹配列或單一列。該 page 後來配對成功，也不會消除版本缺漏。DB 容許 owner 提早對任意列新增保守 loss，但不能清除或改動既有 loss；不能假設只有一個標記。這份 reader 契約已記錄，實際 reader 與該情境的整合測試尚未完成。

`scripts/wp20-visit-page-disposable.mjs` 驗證 124 個 migration／schema 與實際 context/proof/composition、未知 nonce、遺失回應／無 JS 的 unmatched 期待、outer rollback、身份接管拒絕、idempotent visit、RLS／ACL／immutable／cascade。頁面測試另驗證等待 commit 才交識別字、request-time 呼叫順序、失敗與 unavailable 路徑，以及既有播放器資料斷言。這不等於實際 Next HTTP／CDN／預載／返回快取或非正式部署測試。負載、既有資料升級與部署角色尚未驗證。

## 回滾

停止新 page／tracked prepare 入口，按精確 manifest 反向程式 patch；保留 page／intent／visit 和失敗 evidence，不刪掉 unmatched、不倒填成功或 epoch。只在自建 disposable PostgreSQL 套用 migration，不對既有或正式資料庫操作。本分項未推送、未部署。
