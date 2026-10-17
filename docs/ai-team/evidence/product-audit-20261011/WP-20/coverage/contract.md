# 收集完整性契約與剩餘實作

assessMetricCoverage 評估同租戶/場次/內容版本/觀看模式/指標的 [S,T) 證據。已證實收集區間可以相鄰或重疊，必須聯集完整涵蓋視窗；已記錄遺失/刪除區間只要相交就拒絕完整。無證據null與已審核空gap陣列不同；一毫秒hole不能補猜。輸入上限10,000 ranges。

這個純函式只驗證範圍涵蓋，不能自己證明輸入證據真實。不得用collectionEnabled/collectionStartedAt、現有row count、成功query或session.deliveryComplete生成complete證據。

目前snapshot新增visitCoverage=unavailable/unknown_history，真實DB有兩筆visit也保留unknown。這是中間狀態，絕非完整WP20實作；不得以永久不可計算取代使用者要求的完整統計。

接續工作：
1. 由已接線且經驗證的server collector產生持久化、scoped的收集期間證據，明確處理開始前歷史與停用/重新啟用的空窗；不能為舊資料自動認證完整。
2. 寫入失敗、遺失與cleanup必須留下可讀取的缺口；與report失效/版本鎖同步，避免先讀facts後再讀不同revision的coverage。
3. snapshot adapter在同MVCC交易讀取完整證據及loss history，按指標分開評估；僅complete可將其facts轉成core input的非null陣列。
4. 完整visitor/registration/viewing/order歸屬、browser RTT不確定性、background executor/scheduler、UI與synthetic E2E/獨立review仍未完成。

驗證：純函式與snapshot19 tests、lint/tsc、DB130/schema/98 migrations/cleanup PASS。尚未有持久化coverage證據或enabled collector，不能宣稱已有完整統計結果。
