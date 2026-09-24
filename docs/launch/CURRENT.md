# CelebrateDeal 目前版本與上線缺口

更新：2026-09-25（Asia/Taipei）。本頁是目前 staging 驗收的入口；每項 PASS 必須對應當次部署與執行證據。過去的工作紀錄保留原始結論，不自動升級為新版驗收。

## 來源與站台

- 已合併的受保護 PR 包含 #274–#282；#279 的兩條完整 `quality` [run 36039658683](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36039658683)／[run 36039702788](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36039702788) 成功，[合併後 master CI run 36042525599](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36042525599) 亦成功。#281 的兩條完整 `quality` [run 36051699430](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36051699430)／[run 36051705298](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36051705298) 成功。[受保護 Preview 身分檢查](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36035415243) 成功。此處的 CI 證據各自綁定當時 commit，不代表尚未執行的後續變更。
- 指定 [staging 網址](https://celebrate-deal-staging.carry-digital-nomad.in.net) 於本次更新時指向 Ready 的 Preview deployment `dpl_3AjUwKJDVvQZmHgw4bC5txTd6EJA`，immutable host 為 `celebrate-deal-staging-jtozttm8m-a25814740s-projects.vercel.app`。GitHub Deployment lineage 對應 PR #277 的 source `9193326824b8b6bf774bdfa28e4783a1a1b8f304`；PR #278 僅增加驗證 workflow，沒有重新部署應用程式。
- 固定網址的 `/`、`/login`、`/api/health` 回應 200，health 回報 `ok=true`、`database=ok`；未授權 `/api/admin/preflight` 回應 401。受保護 workflow 以既有 `JOB_SECRET` 對 immutable Preview 驗證 Supabase 公開 URL、執行期／migration／staging DB identity 與 DB 可連線，僅輸出布林結果，全部通過。這些證據不等於登入、Funnel 或付款旅程通過。
- 匿名真實瀏覽器在桌機及手機對 `/`、`/login` 均取得 200，未觀察到 console error、page error 或 5xx；尚未涵蓋登入後頁面。
- [受保護唯讀診斷 run 36051276197](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36051276197) 的 sanitized receipt 顯示 staging DB 已完成 58／預期 79 個 Prisma migration、無 unresolved failure、已完成部分無 checksum mismatch；固定 WP4 fixture 的唯讀 preflight 為 `READY`。這不能單獨斷定 fixture POST 503 的根因，也不能證明最後 21 個 migration 就是缺口；精確名稱與順序仍待驗證。
- PayUni 保持 Sandbox。尚未證明目前部署的商家綁定、實際成功買家訂單與 callback 閉環；不得把環境旗標或健康檢查當成外部交易成功。
- `vercel env run` 無法讀回寫入後不可見的 Secret 值；先前文件由此推論資料庫設定缺失是錯誤的。以上受保護 runtime 檢查已取代那項推論，不要求使用者重提供既有 Secret。

## 驗收狀態

| 範圍 | 狀態 | 尚需的證據 |
| --- | --- | --- |
| master 與部署來源 | 已驗證 | PR、CI、GitHub Deployment lineage、Vercel alias／deployment 對應如上；後續新部署須重驗 |
| DB／Supabase project identity | 已驗證 | 受保護 Preview 身分檢查通過；Auth、Storage 等實際使用資源仍須各自核對 |
| 固定 staging 核心瀏覽器旅程 | **NOT_PROVEN** | 合成資料的登入、Funnel 建立／保存／發布與公開表單、商品、影片、行動版與關鍵 console／5xx；本機 Playwright CI 不能替代固定站驗收 |
| 固定 staging 登入後頁面煙測 | **BLOCKED** | [受保護 run 36054693775](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36054693775) 的 sanitized receipt：合成 session 已建立、桌機／手機共 8 個路由皆 200，沒有 page error／同站 5xx；預期內容未出現，runner 同時擋下 47 個非 GET 請求。尚無法判定為網站缺陷或驗收工具阻擋載入，需查明最終路徑與請求類別；此檢查不涵蓋正常登入、Funnel 保存或付款 |
| PayUni Sandbox 買家訂單 | **NOT_PROVEN** | 同一固定部署上一筆成功付款、callback、持久化訂單、使用者可見狀態及重複 callback 冪等性；退款／對帳屬更完整的財務閉環 |
| Sandbox runner 前置關卡 | 已修復並通過 | PR #279 將 Prisma Client 生成移到所有 task 共用前置步驟；[受保護綁定檢查](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36042545323) 已通過，不顯示測試卡或 Secret 值 |
| 固定 Sandbox 交易嘗試 | **BLOCKED_BEFORE_PAYMENT** | [受保護 run 36042691222](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36042691222) 的 validated sanitized receipt 為 `FIXTURE_HTTP_REJECTED`；`checkoutPosts=0`、`payments=0`、`refunds=0`。須先唯讀診斷 migration 與 fixture 前置狀態，不重送付款 |
| staging Prisma migration | **DRIFT：58／79** | [受保護唯讀診斷](https://github.com/Forty-s-AI-Company/CelebrateDeal/actions/runs/36051276197) 發現 21 個差額；尚需確認精確名稱、套用順序及目前版本的備份／隔離還原能力，不能用舊版固定 58 的備份 gate 視為修復許可 |
| 舊 PR #210／#211 | 待按功能整合 | 兩者仍有衝突及獨有功能；清單見 [Git 盤點](integration-inventory-20260924.md)，不能宣稱「全部合完」 |
| Production | 未評定 | 正式部署、正式資料與正式金流不在本輪授權內 |

依 [Goal Plan](goal-plan-20260924.md)，本輪必需的 `CORE_STAGING_READY` **尚未成立**。staging 已換新版，PR #279 與合併後 master CI 通過。固定站核心操作和 Sandbox 成功訂單證據仍缺，Codex Goal 不應標為 complete。

下一步先用固定來源、受保護、唯讀的診斷流程查明精確 migration 缺口及 fixture 503 的兩條候選路徑（部署 source SHA 設定、fixture 寫入例外）；現有 preflight `READY` 只證明固定 fixture 所需前置條件可查，不能代替 schema／實際寫入驗證。確認目前版本可用的備份與隔離還原 gate 後，才考慮非 Production migration 修復與下一次 Sandbox 交易。另須建立固定 staging 的登入後核心瀏覽器收據，將 Sandbox 成功付款與訂單 DB readback／callback replay 串在同一個 lineage 綁定驗收。未證實的項目保持 `NOT_PROVEN`。較細的未製作功能見 [下一輪清單](NEXT-CYCLE.md)；歷史 checkpoint 見 [執行紀錄](goal-progress-20260924.md)。
