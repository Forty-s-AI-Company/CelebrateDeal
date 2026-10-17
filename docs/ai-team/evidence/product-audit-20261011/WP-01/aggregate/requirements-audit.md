# WP-01 完整要求核對

採用 Goal Plan 第 103、161 行與使用者 D-1 決定；D-1 保留雙層發布，因此 Funnel 存成發布版本不表示專案已可公開。不得放寬專案發布閘門。

| 要求 | 目前來源與證據 | 判定 |
| --- | --- | --- |
| 無專案時能採取行動 | no-project snapshot 來源未變；browser-result 建立專案／選擇既有專案目的地皆200；canonical gate 重驗 | 達成 |
| 諮詢模式導向可用頁 | consultation snapshot 來源未變；兩次建立的既有 modules 保留、consultation 不重複、sidebar 與頁200；canonical gate 重驗 | 達成 |
| 未發布專案須顯示指定警示、缺項與連結 | dual-publication targeted tests 與 strict/semantic browser；本次 form-submit 亦覆蓋實際 Funnel 發布後專案仍 draft、公開404 | 達成 |
| 商家可辨識公開404原因 | 未發布專案、停用表單、無效 operations 的商家訊息與匿名404分離；Chromium/Firefox evidence與tenant/project guard測試 | 達成 |
| 公開200且表單可實際送出 | form-submit 最新同 snapshot Chromium/Firefox，真實填寫與按鈕送出200、UNVERIFIED/來源入庫、重送單筆與verification queued/0 attempts | 達成；不代表信件已送達 |
| schema與發布閘門不變，含verified付款方式 | verify-evidence.py 比對基底 publishSalesProjectAction 完整函式；schema/migrations diff空；原查詢parity單元測試收據來源未變 | 達成 |
| targeted＋E2E＋axe | 三份既有canonical gate在現行來源重新READY；新增瀏覽器收據來源核對PASS，兩瀏覽器axe零violations、cleanup完成 | 達成 |
| 前置WP06／G2 | WP06／WP07 acceptance READY且各自來源snapshot仍相符 | 達成 |
| 單一入口保留WP17 | 本WP沒有改為單一發布入口 | 達成 |

驗收方式：原產品來源没有再改動，逐子項以原review與執行收據重跑assess_acceptance；公開發布gate增加 current-registration-evidence 驗證，檢查新增瀏覽器receipt、腳本及依賴來源hash、實際報名斷言、前置WP与基底閘門。沒有把新browser收據改寫成旧revision，也沒有假裝本輪重跑過舊unit或provider review。

非阻擋追蹤：Firefox 曾在後续活动截止的商家頁導覽失敗，完整重跑通过，原因未知；所有原失败收据保留。負載／發布併發測試NOT_RUN，非本WP明訂验收；不宣称不存在竞态。原始publish project的成功閘門由基底函式與parity tests保護，公開渲染測試使用合成published fixture，不宣称已做真实付款方式verified流程。信件送達／LINE與提醒仍屬其他WP與外部驗證範圍。

本輪新增文件與驗收證據；產品改動0。回滾只撤销aggregate文件及本轮checkpoint，不影響其他WP。
