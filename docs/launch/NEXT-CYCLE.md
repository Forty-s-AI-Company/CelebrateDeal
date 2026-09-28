# CelebrateDeal 下一輪工作

更新：2026-09-28。狀態與精確部署來源以 [CURRENT.md](CURRENT.md) 為準；待做項目不等於已驗收。

1. **Funnel 匿名公開頁**：#338／#340／#341 已受保護合入。Tokyo 新版 `29ba9f6a` 的 [run 36371699449](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371699449) 已完成建立、模板、進入編輯器、儲存與發布，剩 PUBLIC_DESKTOP_FAILED。先唯讀核對合成 SalesProject 是否發布；公開頁程式要求父專案 published，而 runner 未包含此步驟。若缺前置條件，補齊正常合成專案流程，不直接繞過公開條件；若不是，補上公開回應／渲染的有限診斷再查原因。Chrome 曾被擴充功能視窗阻擋，需關閉該介面才能繼續 UI 唯讀核對。
2. **Dashboard 與 R2 已通過**：staging Functions 已從 iad1 調整為與資料庫同區的 Tokyo hnd1；[browser run 36371696707](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371696707) desktop/mobile 五頁及互動 **PASS**，KPI／明細均可見且無關鍵資源失敗。[R2 run 36371701629](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36371701629) 合成圖片上傳及公開讀取 **PASS**。後續來源更新時重驗；不要以舊來源替新版驗收。
3. **PayUni Sandbox 未明交易**：[唯讀 run 36260940732](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36260940732) 顯示本地 `PENDING`、provider `UNKNOWN`、無 callback、缺 provider 查單參考值。先在官方 Sandbox 後台唯讀核對原交易；釐清安全後才建立**新**合成付款，驗證 callback、持久化訂單與重複 callback 冪等性。不得重送原交易或退款；正式金流不在本輪。
4. **Stream 隔離**：唯讀連線可用，但 Vercel 綁定的 Stream token 是否只觸及非正式資源仍未驗證。用可審查、無 Secret 輸出的權限證據或非正式資源探測補足；不可把 R2 staging bucket 的通過結果轉算為 Stream PASS。
5. **舊 PR 與非核心功能**：[PR #210](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/210)／[#211](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/211) 仍有衝突。依[整合盤點](integration-inventory-20260924.md)逐功能核對學員入口、LINE 圖文選單、聯盟入口與商品差異，按租戶、Auth、schema 與測試風險分批整合。表單提交、checkout 非付款階段、影片處理及其他商家操作仍缺固定站證據；Production 準備另行驗收。
