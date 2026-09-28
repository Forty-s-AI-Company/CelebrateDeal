# CelebrateDeal 下一輪工作

更新：2026-09-28。狀態與精確部署來源以 [CURRENT.md](CURRENT.md) 為準；待做項目不等於已驗收。

1. **Dashboard 明細與 Funnel 編輯器**：#338／#340 已受保護合入並部署。browser run 36368967262 已完成 desktop/mobile 五頁導頁與互動，但 Dashboard 明細仍未就緒；Funnel run 36367356009 已越過管理頁載入，建立及模板成功，改卡在 Edit Page 導頁。待 #341 綠燈合入，以新的有限網路／導頁分類收據定位原因，再完成修復與完整旅程驗收。Next.js route announcer 不是應用錯誤；不得把延長逾時當作未經診斷的修復。
2. **R2**：目前來源 `f0c82857` 的 [run 36368969912](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36368969912) 合成圖片預簽、PUT、完成回報及公開讀取 **PASS**；來源更新時重驗，只使用 staging bucket 與合成資料。
3. **PayUni Sandbox 未明交易**：[唯讀 run 36260940732](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36260940732) 顯示本地 `PENDING`、provider `UNKNOWN`、無 callback、缺 provider 查單參考值。先在官方 Sandbox 後台唯讀核對原交易；釐清安全後才建立**新**合成付款，驗證 callback、持久化訂單與重複 callback 冪等性。不得重送原交易或退款；正式金流不在本輪。
4. **Stream 隔離**：唯讀連線可用，但 Vercel 綁定的 Stream token 是否只觸及非正式資源仍未驗證。用可審查、無 Secret 輸出的權限證據或非正式資源探測補足；不可把 R2 staging bucket 的通過結果轉算為 Stream PASS。
5. **舊 PR 與非核心功能**：[PR #210](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/210)／[#211](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/211) 仍有衝突。依[整合盤點](integration-inventory-20260924.md)逐功能核對學員入口、LINE 圖文選單、聯盟入口與商品差異，按租戶、Auth、schema 與測試風險分批整合。表單提交、checkout 非付款階段、影片處理及其他商家操作仍缺固定站證據；Production 準備另行驗收。
