# CelebrateDeal 下一輪清單

更新：2026-09-26。此清單依目前 [staging 收據](CURRENT.md) 排序；未執行項目均非 PASS。

1. **固定站瀏覽器旅程**：同一來源兩次煙測各有一次 JavaScript／CSS 資源載入失敗；較新的 [run 36247730669](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36247730669) 已證明 Dashboard 外框與 KPI 載入，明細串流尾段在 20 秒內仍未完成。先讓 [PR #328](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/328) 的有上限並行讀取通過受保護 CI、合入並更新固定站，再用新來源跑完整瀏覽器煙測。關鍵 JS／CSS 失敗仍是獨立風險；未取得新證據前維持 BLOCKED。
2. **PayUni Sandbox 未明交易**：[PR #325](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/325) 已實作固定買家唯讀查單 API，待 CI、部署與對 2026-09-26 那次合成提交的受保護收據。確認沒有付款／退款在途後，再決定是否需要新的付款測試；接著驗證目前來源的 callback、持久化訂單與重複 callback 冪等性。SaaS checkout、退款、對帳與佣金結算另排，不把舊來源成功收據當作新版 PASS。
3. **固定 staging 的完整核心旅程**：以合成資料實測 Funnel 建立、編輯保存、公開、表單提交到商品 checkout 的非付款階段；補圖片上傳後的公開讀取、影片處理與商家常用操作。先前通過的十頁瀏覽器煙測只涵蓋讀取與局部表單互動。
4. **R2／Stream 資源範圍**：staging bucket 已啟用公開 r2.dev，且已加入固定 staging origin 的最小 PUT CORS；待 [PR #326](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/326) 綠燈後以合成圖片證明實際上傳與公開讀取。Stream token 仍缺對 Vercel 綁定值與非正式資源範圍的證據；Cloudflare UI 可見的 Stream／Images token 為所有帳戶範圍，不能以唯讀可連線推論 staging 隔離。
5. **舊 PR 的獨有功能**：PR #210/#211 仍有衝突及未移植的學員入口、LINE 圖文選單、聯盟入口與部分商品頁差異。依 [路徑與風險盤點](integration-inventory-20260924.md) 分批確認需求、租戶權限、schema 與測試，再用小型 PR 整合。
6. **非核心功能與 Production 準備**：依實際使用優先修資料遺失、卡住或無法完成任務的問題，再處理視覺細節。正式服務設定、法務／客服、備份演練與正式金流另做獨立驗收。

上述尚未完成的核心項目仍屬 [現況入口](CURRENT.md) 的上線缺口；列在下一輪不等於已驗收或可以忽略。
