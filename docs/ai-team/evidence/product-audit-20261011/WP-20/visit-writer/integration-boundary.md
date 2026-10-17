# 尚未完成的入口邊界
recordMetricVisit 只接受由 server 解析的既有 visitor scope，request 僅 eventId。不能直接以 HTTP payload 的 visitorId/versionId 呼叫。
既有 src/lib/team-funnel-attribution.ts 的 visitorIdFromRequest 只做字串格式檢查，並非已驗證的 browser possession。不得把它的輸出當作本服務 trusted scope，或沿用它來強行連接個人報名。
下一步須建立或確認可驗證且限租戶/版本的第一方 visitor context、伺服器端版本解析及收集啟用證明；具備same-origin、rate-limit、body-limit與generic errors，再接造訪與報名流程。只在核准非正式環境與合成資料啟用，不能推定D-5或正式追蹤政策已核准。
本輪未改動既有 attribution 函式，也未讀取任何真實Cookie值或Secret。
