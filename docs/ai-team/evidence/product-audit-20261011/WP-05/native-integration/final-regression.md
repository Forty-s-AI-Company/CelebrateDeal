# WP05 最新入口回歸

本輪移除未引用的 src/app/p/[slug]/loading-shell.tsx；其原內容留在 partner-loading-shell-before-removal.txt。未重新加入報名入口的 loading boundary。

以 snapshot-final-regression.json 固定產品來源。unit/lint/typecheck、原提交核心不變、真實 disposable PostgreSQL、四種公開入口共24個 Chromium/Firefox JS/noJS案例，以及額外403/404/429流程均執行。503沿用同版本實際 route/DB測試，不冒稱瀏覽器503 fault injection。

另補一般 Funnel 原生成功目的地可見性：原測試錯把 step 的設定感謝頁當成原頁 status，chromium:step timeout，保留 browser-lp-feedback-before.json。修正测试契約：根頁必須有已驗證成功status；步驟頁須抵達其設定的感謝頁，並看見合成設定內容；所有既有DB/草稿/無寄信斷言不變。結果以最新receipt為準。

一次性flash並非原WP驗收承諾；目前短期成功回條及有效草稿可重見，沒有有效草稿時錯誤網址只提示結果未確認。此設計與UI-5人工AT未驗證均送交獨立review，不自行當作審查通過。

最新review尚未執行；先前追加兩次呼叫已用完。review-final-authorization-request.json列出精確版本與追加2次範圍。WP05及完整Goal未完成，其他決策依賴不解除。

回滾只恢復本輪未引用元件（從保存副本），或反向本輪測試/文件變更；不使用整工作樹restore。原工作樹未寫入，無commit/push/deploy。
