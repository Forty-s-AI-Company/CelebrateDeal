# Funnel 最終能力狀態（2026-09-17）

本表是 2026-09-17 本機／disposable 最終整合後的能力盤點。完整命令與 receipt 以 [`funnel-final-integration-20260917.md`](../ai-team/evidence/funnel-final-integration-20260917.md) 為準；不代表 Production deployment 或正式付款驗收。

| 範圍 | 目前合約狀態 | 最終驗證 |
|---|---|---|
| 四 Goal：Audience、Sell、Custom、Automated Webinar | 已有產品／資料合約；Webinar 為 CelebrateDeal 自有規格 | `PASS`（browser 4/4） |
| Elements | 多數 editor／renderer 能力已有；Payment、reCAPTCHA、Raw HTML、Tracking、Affiliate 受限制 | `PASS`（已實作能力）；限制如實保留 |
| Blocks | 九分類、registry、節點展開與 responsive 合約已有 | `PASS`（registry／unit + browser representative） |
| Popup | auto-delay、內容、style、preview 合約已有；desktop exit intent 已驗證，mobile 不支援 | `PASS_WITH_LIMITATION` |
| Page Settings | typography、language、background、SEO、dirty state 合約已有 | `PASS` |
| Secondary tabs | Automation、A/B、Stats、Leads、Sales、Deadline、Funnel Settings 的 persistence／runtime 合約已有 | `PASS`（85 integration + browser） |
| Schema／migration | LandingPage versioning、runtime attribution、inventory snapshot 為 additive 設計 | `PASS`（87 migrations，isolated synthetic DB） |

已知限制：不把 systeme.io 帳戶配額當成 CelebrateDeal 規則；不執行正式付款、正式 migration、正式 deployment；未驗證的能力維持 `LIMITED`／`UNVERIFIED`，不顯示假成功。
