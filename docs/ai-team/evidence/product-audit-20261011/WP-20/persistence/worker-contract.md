# WP-20 持久化整合契約（進行中）

- 收集預設關閉；只使用 disposable PostgreSQL 與合成資料，產品 API 尚未接入。
- interval 收件時間及 session 建立時間由 PostgreSQL clock_timestamp 決定。不能信任客戶端或測試主機的時鐘；容器時鐘不同步時，測試必須等待資料庫時間到達合成區間終點。
- sequence 從 0 連續遞增，wall 範圍可有間隔但不得重疊。入庫後才更新進度；finalSequence 一旦宣告不可改，完成必須有完整連續區間。interval 不能個別刪除，但允許隨 session/version/live/vendor cascade 清除。
- API 仍須實作同序號同 payload 冪等、衝突拒絕、batch 限額、驗證報名與 admission 的同一人綁定。
- sourceRevision 現在代表版本設定異動，普通 interval 不再更新單一共用 counter。evidence 只讓時間範圍重疊的報表失效；新資料在報表時間窗之外不影響它，遲到但在窗內的資料仍會令報表失效。
- 報表建立使用 wp20_metric_report_create；領取／完成使用 wp20_metric_report_claim / wp20_metric_report_finish。三者先取得 version 鎖；直接 INSERT 或切換 running/ready 會被 guard 拒絕。不能用 ORM 的直接寫入代替。
- 同一視窗與 structural revision 最多一個 queued/running/ready 報表；stale/failed 不占此唯一限制，容許重建。
- 過期 worker lease 可以重新領取；舊 owner 不能完成新 lease。最多五次領取，後續改 failed/attempt_limit，避免崩潰工作無限重試。工作斷點與續租尚未接入應用程式。
- interval 與 session 建立依序鎖定 Live、FormSubmission、admission、version，再鎖 metric session；receipt 時間在鎖等待後取得。verification/form/video 變動會使受影響版本報表失效；正常 admission 刪除保留歷史報表，縮短期限只失效重疊視窗，歷史已接受的 interval 保留。三個兩交易測試已觀察等待鎖後拒絕寫入並失效舊報表；整體仍待深度複審，不能標 READY。
- 產品 identity/API/player/background aggregation/UI、browser 驗證與整包 acceptance 尚未完成。

- 新統計表全部時間欄位使用 timestamptz(3)，函式固定 UTC；既有來源表不改 schema。Asia/Taipei 實際插入測試已通過；更多 report lease 時區矩陣待補。

- 報名來源變動只失效包含該 verifiedAt 的 cohort 視窗，不再改寫整版本 revision；縮短 admission 期限使用完整 tenant/live/version 範圍。新統計寫入與報表路徑明確要求 ReadCommitted，避免舊 snapshot 漏掉新報表；整合時須遵守。
