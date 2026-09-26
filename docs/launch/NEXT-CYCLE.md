# CelebrateDeal 下一輪清單

更新：2026-09-26。此清單依目前 [staging 收據](CURRENT.md) 排序；未執行項目均非 PASS。

1. **固定站瀏覽器旅程**：[PR #328](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/328) 已合入，[run 36250829960](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36250829960) 對來源 `d723fda05bd363edfbb8905f63d39519910039fc` 的 desktop/mobile 五頁、Dashboard 資料與互動取得 **PASS**，關鍵資源失敗為 0。後續合併 R2／Funnel 等 PR 並更新固定站後，須對最後來源重驗；舊來源曾出現偶發 JS／CSS 失敗，不能把單次 PASS 當成永久保證。
2. **PayUni Sandbox 未明交易**：[PR #325](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/325) 已合併並部署；[唯讀 run 36249383090](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36249383090) 回報 `REFERENCE_UNAVAILABLE`，本地仍 `PENDING`，沒有可安全執行的 provider 查詢。先用唯讀途徑確認舊交易的完整參考值與 Sandbox 狀態；未釐清前不得重送付款或退款。確認安全後，才測新版 callback、持久化訂單與重複 callback 冪等性。SaaS checkout、退款、對帳與佣金結算另排，舊來源成功收據不是新版 PASS。
3. **固定 staging 的完整核心旅程**：[PR #329](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/329) 已合併；[run 36253747470](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36253747470) 建立了合成專案，但 Funnel 建立表單不可用，停在 `CREATE_PAGE_UNAVAILABLE`。先待 [PR #331](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/331) 的安全狀態診斷判明根因，再修復並驗證建立、套模板、存草稿、發布與匿名公開頁。表單提交、商品 checkout 非付款階段、影片處理與其他商家操作仍未取得固定站證據；十頁瀏覽器煙測只涵蓋讀取與局部表單互動。
4. **R2／Stream 資源範圍**：staging bucket 已啟用公開 r2.dev，且已加入固定 staging origin 的最小 PUT CORS；[PR #326](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/326) 已合併。[受保護 run 36252337294](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36252337294) 實際完成合成圖片上傳與公開 bytes 比對，但整體因一筆未分類的攔截請求為 BLOCKED；先用 [PR #330](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/330) 的安全分類釐清，再依結果修復或重驗。Stream token 仍缺對 Vercel 綁定值與非正式資源範圍的證據；Cloudflare UI 可見的 Stream／Images token 為所有帳戶範圍，不能以唯讀可連線推論 staging 隔離。
5. **舊 PR 的獨有功能**：PR #210/#211 仍有衝突及未移植的學員入口、LINE 圖文選單、聯盟入口與部分商品頁差異。依 [路徑與風險盤點](integration-inventory-20260924.md) 分批確認需求、租戶權限、schema 與測試，再用小型 PR 整合。
6. **非核心功能與 Production 準備**：依實際使用優先修資料遺失、卡住或無法完成任務的問題，再處理視覺細節。正式服務設定、法務／客服、備份演練與正式金流另做獨立驗收。

上述尚未完成的核心項目仍屬 [現況入口](CURRENT.md) 的上線缺口；列在下一輪不等於已驗收或可以忽略。
