# 保留的失敗與修正

- browser-lp-fixture-failure：測試建立form節點漏children；既有parsePageDocument正確拒絕，補有效空children後通過。沒有降低parser。
- browser-webinar-missing-schedule-failure：合成Webinar漏開始／結束時間，既有公開gate正確不顯示表單。補上未來的有效排程後通過，沒有修改活動gate。
- browser-partner-attempt1／contrast-failure：真實serious color-contrast，LeadForm預設#f97316配白字不足；改預設#c2410c後重跑全部入口。既有商家自訂themeColor未覆寫，不宣稱任意自訂色都符合對比。
- 夥伴fixture清理P2003：先前cleanup缺少salesTeam顯式刪除；補上既有E2E使用順序，再精確清除兩個失敗run的合成vendor/user。partner-prior-fixture-cleanup.json保存結果。

這些失敗原始結果與receipt皆保留，未以新PASS覆蓋原failure檔。測試只建立已發布的合成資料快照來驗證公開讀取與報名，不驗證商家發布流程；既有發布閘門另由WP01證據涵蓋。本輪未呼叫付款或寄信。
