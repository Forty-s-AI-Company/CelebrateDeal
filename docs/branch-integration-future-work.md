# 分支整合：未來處理與接手報告

## 2026-10-06 剩餘功能 Goal：編輯器生命週期已交付，課程流程實作中

接手基準為 master `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，#368 已合併，接手時 open PR 為空。本節更新當前功能進度，保留下方來源與歷史收據。

F3.1 已實作：相同父層文件回傳保留 Undo/Redo，外部文件替換重建 session，唯讀期間阻擋 toolbar/keyboard/workspace 還原；實際 WorkspaceEditor 以穩定 page ID 保留儲存後歷史。Callback 移出 React state updater，避免 Strict Mode 重複副作用。14 項 targeted unit、9 項 Chromium、TypeScript 與 ESLint PASS；獨立 reviewer 的儲存版本 key MAJOR 已修正，增量複審無 findings，canonical acceptance READY。PR [#369](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/369) 已依 expected head squash merge 為 `2319c742f1455681ff08b720c193a2faf1545e27`；push run `37354840583` 與 PR run `37354873011` quality PASS。merge tree 與已驗收 head `00d43f4875489a1fa6f0b30a5cb2397f35fa3743` 無差異。

工作矩陣見 [remaining-capabilities-work-matrix-20261005.md](remaining-capabilities-work-matrix-20261005.md)，本批新證據見 [remaining-capabilities-f3.1-local-receipt-20261006.json](remaining-capabilities-f3.1-local-receipt-20261006.json)。F1/F2/F3 其餘完整互動/Q1/Q2/A1/E1 仍未全部交付，Goal 保持 IN_PROGRESS。原始 dirty 目錄與來源分支未寫入，未操作正式環境或外部 provider。

F1.1 正在接上商家發布單元、學員權益、持久化進度與證書，僅新增前向 migration。84 條 migration 與 7 項 PostgreSQL 回歸本機 PASS；一項完整 Chromium 原生課程旅程已通過，獨立 Critical review 的兩個 MINOR 已修正且增量複審無 findings；canonical acceptance READY，收據見 [remaining-capabilities-f1.1-local-receipt-20261006.json](remaining-capabilities-f1.1-local-receipt-20261006.json)。精確 head PR CI 與受保護合併仍待交付。社群、多語/PWA/通知、F2、Q1/Q2、A1 仍須完整實作。

## 2026-10-05 收尾處置（本節優先於下方歷史狀態）

本輪以 `533cffd72fe266726a1c242e1bff9203e2b74f6b` 為 master 基準。#367 已合併；本收尾 PR 交付剩餘可獨立使用的路由、QA 指令、合成 fixture 與瀏覽器持久化／未啟用步驟斷言。其餘來源已依功能歸類保留，並非宣稱所有歷史功能都已完成。

### 已合併成果與 PR 去向

| PR | 去向／master commit |
| --- | --- |
| [#351](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/351) | master `40db1781aa9d2bf17013c328a390dfecef7eee11` |
| [#352](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/352) | master `fc28e1b8dcdba9ca3926f11d27153de048f597da` |
| [#353](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/353) | 由 #352 承接並關閉，來源保留 |
| [#354](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/354) | master `42bce600e9c6b88003bd3b2a924d0ea96c70aee8` |
| [#355](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/355) | master `c071b2d655b0d875fa9d616920c5a554d462dbe6` |
| [#356](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/356) | master `0f6cdbfa19e2bfe16c64513e85b0b4741d42f7a2` |
| [#357](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/357) | master `361a37da2b487bbfa17f419d7b72b9306da07c99` |
| [#358](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/358) | master `9c45f10314faff768a33fac3f3770517b859ddce` |
| [#359](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/359) | master `e2014b5d3eecf71e2bb9b66861d6c50fafc1f449` |
| [#360](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/360) | master `11541b6ac097ea957f2152710e7d9f405b4bfccb` |
| [#361](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/361) | master `de0addfd895723db797b85aab7a0abb466bc624e` |
| [#362](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/362) | master `fadfe59d044290c69c8bfd9919dcbf571a5f7f41` |
| [#363](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/363) | master `52b81e3a624960ce9479be3c1bd682d2e7cb308d` |
| [#364](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/364) | master `9a76580124edf373f9ad4d8d18aaa45a8150d1d1` |
| [#365](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/365) | 已合入 #364 來源分支，內容隨 #364 進 master |
| [#366](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/366) | 已由 #364 承接並關閉，來源保留 |
| [#367](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/367) | master `533cffd72fe266726a1c242e1bff9203e2b74f6b` |

#367 head `648783089441725043624e1861b63400e652322a` 的兩個 quality CI（37317493704、37317489167）成功；canonical `assess_acceptance` READY，0 blockers。合併後 master tree 與已驗收 head 完全一致。新增公開表單及驗證信檢查：六檔 92 cases、ESLint、TypeScript PASS；唯讀 Critical 增量審查無 findings。驗收收據最初遇 Windows CP950 解析 GitHub UTF-8 回應失敗，明確修正解碼後通過，沒有重啟 CI。

#210（`b7956d803f8d`）與 #211（`b5397dbb45dd`）採「可用段落已由後續 PR 承接、未完成需求轉本報告」處置；本收尾 PR 合併後關閉舊 PR，不刪來源分支。#210 的 LINE 草稿／學員登入入口與原始 onboarding/MFA/直播互動已分批交付；#211 的 editor/可信結帳、表單／發布／歸因與庫存回歸已由 #355、#364、#367 等承接。不同實作不當作缺失，舊 migration 不重複套用。

### 尚未完成而保留的功能

| 編號 | 來源與範圍 | 下一步／未驗證界線 |
| --- | --- | --- |
| F1 | #210／#211、`60132971`、`de515182`、`e1f38be3`：原生課程播放器、progress／certificate、community、i18n／PWA／push、SMS／WhatsApp | 依目前 portal session、租戶鍵與權益模型重接完整垂直流程；現有 #357 登入與 dashboard 不代表上述功能驗收。保留對應 `src/app/portal/**`、`src/lib/course-*`、`community`、`i18n` 等來源。 |
| F2 | 同組來源：affiliate portal、階梯／多層佣金、稅扣繳／payout export、referral cards、post-purchase upsell、server tracking／webhooks、private instructor chat／purchase broadcast | 需與目前收入快照、角色權限、資料模型與 provider 契約整合；先建立跨店家／併發／退款回歸，再接 UI。不得直接恢復舊 migration tree、舊金融設定或未驗證 provider。 |
| F3 | #211 active editor 的 undo/redo／完整進階互動；來源 disposable QA 與新的 team/video UI／guard inventory | 現行 editor 核心已存在；仍需驗證 parent document echo、history lifecycle、popup／template／flow 的完整瀏覽器互動。舊 UI selector 只於對應 UI 交付後適配。保留 `scripts/*-disposable-qa.mjs` 等來源，不把舊收據當本次 PASS。 |
| Q1 | `35d8f59341bc` 的 sandbox refundThroughCelebrateDeal／waitForRefundPersistence／refundPersistencePassed／latestRefundableCheckout | 固定 staging PENDING_REFUND consumer 尚未完成；先替換 broad latest-order 選擇與 bypass，再驗證單筆 processed RefundRecord、冪等及重複退款拒絕。未執行真實付款、退款或寄信。 |
| Q2 | `eac0a3430df3` 的 owner-session／buyer continuation、wp4 buyer/subscription recovery；原分支 `.env.example` metadata | 現行 staging browser/apply/replay/backup/provider 守門已承接；剩餘 ops endpoints 需固定非 Production 綁定及隔離回歸才能發布。環境範本內容未讀取或驗收，保留原 Git blob。 |
| A1 | `937f796d25d0`、`bf45235f8b10` 的舊 AI Team／automation 與歷史應用 snapshot | canonical vNext 取代重複 router、prompt、model ladder；來源未對齊的舊應用／workflow 需按 F1/F2/Q1/Q2 相依遷移，不併存第二套啟動器。沒有執行舊自動排程。 |
| E1 | 原始歷史 release、Funnel、Opus/model-refresh 收據與 synthetic config 舊 tmp/support 排除差異 | 原檔保留；後續驗收按候選重建 sanitized evidence。tmp/support 排除尚未遷移，避免未對齊目錄就降低實際測試範圍。 |

### 所有剩餘分支的處置

一次取得的最新未合併 Git refs 共 535 筆、356 個 head（squash 後仍不具 ancestor 關係不代表工作未交付）。沿用 [既有逐 ref 證據](branch-integration-audit-20261004.json)：450 筆有 merged PR 去向，其餘既有相同內容／patch 等價／替代記錄保持有效；64 筆舊待查 refs 由下表與既有 15 組 supersession 收據收斂，不重做整段歷史盤點。

新出現的 7 筆 refs（5 個 head）全部有去向：`b3ddc37b` 是 #351 accepted head 的 ancestor；`49e884ff` 是 #352 accepted head 的 ancestor；`cc55ea81` 是 #357 accepted head 的 ancestor，學生審查文件與 master 相同；`5e6c962a` 的 shell dependency 文件已在 master，dev-hygiene 產品差異由 #360 承接；`9af80668` 的 browser isolation／direct-url 檔案與 master 相同，隨 #364 交付。既有五筆 excluded refs 的 `f5512bf0` preview 已隨 #352 交付，`abc55736`、`45612059`、`177554e1` query 意圖由 #351 及既有 query supersession 證據承接。

下表保留原 27 個仍有共享或未完成範圍的 head。每個 head 的精確來源 refs／原始路徑清單沿用 [deferred-work manifest](branch-integration-deferred-work-20261004.json)，本表取代其籠統 IN_PROGRESS 狀態；不刪分支，也不聲稱整棵舊 tree 逐字一致。

| 來源 head | 最終處置／保留範圍 |
| --- | --- |
| `114689ccd3c4746d5bb8981ddc5c5b88bad7b29e` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `1a918f9e2e1974abc229c4bd76d97d17b398bf63` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `1ff1b5135f723c2da1e4509625284c376d8cf83e` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `227c102b7f49221a9d0fea17536ce2ed9e82312c` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `2401481ce4ea07b1bb7448c62be0db589b73c85e` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `2cceebba802dec508faaad166e37fa1e51b09ed5` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `30230f4ab63c65481324a128ff1369deee073c83` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `35d8f59341bcb776e548c69fe874a3f4d1fe2528` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `36b38ad22f3369e4e5265983e36a7a19ab8eb369` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `39b8dedf2ea140bc264088c9d1843d99196586ff` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `3ace54c10b581285a297c5e95e677178314e1c52` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `60132971f60dbad83aae48ffa6f15d3f57682c6e` | 部分成果已整合；剩餘跨功能與 UI／browser 相依保留 F1–F3。 |
| `62fb1655dc47c7156a68a09ee18b42d4120d9b61` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `638707f9f043498136107b38968e49a0c38e9133` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `67b3fffd94a107c55e6ec4a8a1441645283e6ad0` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `7f1b3fd26e48a41e9e003c848594fa102000f220` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `937f796d25d0e27db753b7786ea77ea3e773a686` | 已由 canonical vNext 取代；未對齊的歷史應用／workflow 保留 A1。 |
| `94e66bdf36b446b12a05dc3312f0d12eeb86421f` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `b5397dbb45ddc4dc15a3059b7dec90b5a7771487` | 部分成果已整合；剩餘跨功能與 UI／browser 相依保留 F1–F3。 |
| `b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` | 部分成果已整合；剩餘跨功能與 UI／browser 相依保留 F1–F3。 |
| `b92d3e91a28f41e3f0fb219db5ad5b80746c387b` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `bf45235f8b10fa1fded2da0a4c079e5b883cfef0` | 已由 canonical vNext 取代；未對齊的歷史應用／workflow 保留 A1。 |
| `de515182fc5fbcccbefa348f33ee7fad1d6ca715` | 部分成果已整合；剩餘跨功能與 UI／browser 相依保留 F1–F3。 |
| `ded82898a687220496add74827691676e84c8b31` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |
| `e1f38be324e349969a657be376aa1602e804c2dd` | 部分成果已整合；剩餘跨功能與 UI／browser 相依保留 F1–F3。 |
| `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7` | 現行 runner 已承接已核對段落；剩餘 recovery／ops 相依保留 Q2。 |
| `ebdbf2e0676e1de46dbef09256c0cb4edb3401c3` | 產品修正已被現行 checkout、analytics、互動、成員確認及 preview 取代；共用 runner 經既有語義核對，未完成金融 QA／環境範本保留 Q1/Q2。 |

### 原始未提交工作逐項去向

原始 120 項：已整合 72、已被取代 36、保留待做 12。來源是 `C:\Users\eden\Downloads\AI\CelebrateDeal`，原 HEAD `60132971f60dbad83aae48ffa6f15d3f57682c6e`。本輪未寫入來源。舊盤點後已有模型更新，因此不聲稱所有檔案仍等於 10/04 雜湊；以本次讀取時的完整 285 筆 status／檔案 hash 建立保留基準，完成後再次核對。

| 原始路徑 | 處置 | 成果或下一步 |
| --- | --- | --- |
| `.agents/skills/ai-team-lite/SKILL.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.agents/skills/ai-team-style/SKILL.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/config/router.astra-standard.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/config/router.high.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/config/router.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/config/router.low.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/config/router.pro.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/config/router.style.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/mcp_server/requirements.txt` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/mcp_server/server.py` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/mcp_server/test_server.py` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Invoke-AgyDeep.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Invoke-AgyFast.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Invoke-AgyPlanReview.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Invoke-AiTeamProcess.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Invoke-AiTeamReadOnlyFailover.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Switch-AiTeamMode.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Test-AiTeamHandoff.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Test-AiTeamResilience.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.codex/config.toml` | 已被取代 | 沿用既有 TOML 語義核對：相對 launcher 與 disabled MCP 相同；不以註解差異覆寫。 |
| `.github/workflows/ci.yml` | 已被取代 | 現行 push/PR CI 已拆分 native checks 並獨立執行 Funnel harness；保留較新的品質與隔離 gate。 |
| `.gitignore` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `AGENTS.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team-payuni-sandbox-qa.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/ai-team/ARCHITECTURE.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/GOAL-PROTOCOL.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/README.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/ROUTING.md` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `docs/ai-team/TROUBLESHOOTING.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/evidence/funnel-commerce-20260917/receipt.json` | 保留待做 | 歷史診斷／收據保留原路徑；下一次對應功能驗收重建新 snapshot 證據，不冒充本次 PASS。 |
| `docs/ai-team/handoff-schema.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/prompts/executor-prompt.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/prompts/planner-prompt.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/workflow-policy.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/external-service-validation-runbook.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/launch/current-release-completion-audit-20260821.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/launch/current-release-gate-handoff-20260821.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/launch/current-release-owner-action-packet-20260822.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/launch/manual-blockers.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/report-3-product-roadmap-and-priorities.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `eslint.config.mjs` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `next.config.ts` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `package.json` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `playwright.config.ts` | 已被取代 | 現行 release suite 與 tests/browser-dev 分離，CI 單獨執行 Funnel harness；R2 清空與隔離資料庫保護已由 #364 承接。 |
| `scripts/external-smoke-safety.test.ts` | 已被取代 | 原始新增行已在現行 runner；保留非 Production host allowlist、禁止跨 origin redirect 與 sandbox credentials 選擇。 |
| `scripts/external-smoke-safety.ts` | 已被取代 | 原始新增行已在現行 runner；保留非 Production host allowlist、禁止跨 origin redirect 與 sandbox credentials 選擇。 |
| `scripts/external-smoke.ts` | 已被取代 | 原始新增行已在現行 runner；保留非 Production host allowlist、禁止跨 origin redirect 與 sandbox credentials 選擇。 |
| `scripts/payuni-sandbox-external-qa.mjs` | 已被取代 | 原始新增行已在現行 runner；保留非 Production host allowlist、禁止跨 origin redirect 與 sandbox credentials 選擇。 |
| `scripts/payuni-sandbox-external-qa.test.mjs` | 已被取代 | 原始新增行已在現行 runner；保留非 Production host allowlist、禁止跨 origin redirect 與 sandbox credentials 選擇。 |
| `scripts/validate-non-production-owner-authorization.mjs` | 已整合 | 原刪除已在 master；本輪未刪除來源。 |
| `scripts/validate-non-production-owner-authorization.test.mjs` | 已整合 | 原刪除已在 master；本輪未刪除來源。 |
| `src/app/(app)/landing-pages/[id]/operations/page.test.tsx` | 已被取代 | 頁面入口 requireVendorManager 與服務層 project/tenant scope 已承接；保留 streaming unavailable 邊界。 |
| `src/app/(app)/landing-pages/[id]/operations/page.tsx` | 已被取代 | 頁面入口 requireVendorManager 與服務層 project/tenant scope 已承接；保留 streaming unavailable 邊界。 |
| `src/app/(app)/landing-pages/[id]/page.tsx` | 已被取代 | 頁面入口 requireVendorManager 與服務層 project/tenant scope 已承接；保留 streaming unavailable 邊界。 |
| `src/app/(app)/landing-pages/page.tsx` | 已被取代 | 頁面入口 requireVendorManager 與服務層 project/tenant scope 已承接；保留 streaming unavailable 邊界。 |
| `src/app/(app)/settings/security/page.tsx` | 已被取代 | Smoke 環境 gate、原限流與 UI 條件已由 #359/#362 承接；保留現行 MFA、return-path、成員管理及 recovery transaction。 |
| `src/app/actions.test.ts` | 已被取代 | Smoke 環境 gate、原限流與 UI 條件已由 #359/#362 承接；保留現行 MFA、return-path、成員管理及 recovery transaction。 |
| `src/app/actions/auth-security-actions.ts` | 已被取代 | Smoke 環境 gate、原限流與 UI 條件已由 #359/#362 承接；保留現行 MFA、return-path、成員管理及 recovery transaction。 |
| `src/app/mfa/setup/page.tsx` | 已被取代 | Smoke 環境 gate、原限流與 UI 條件已由 #359/#362 承接；保留現行 MFA、return-path、成員管理及 recovery transaction。 |
| `src/components/app-shell.tsx` | 已被取代 | 原新增樣式／位置已保留：AppShell text-slate-500、直播提問 bottom-24；現行版本另保留權限與競態修正。 |
| `src/components/landing-page-workspace.tsx` | 已被取代 | 沿用既有 Funnel 語義核對：感謝頁、一般編輯保存 commerce、template swap 保留綁定與同步 content ref 均在主線。 |
| `src/components/live-advanced-interactions.tsx` | 已被取代 | 原新增樣式／位置已保留：AppShell text-slate-500、直播提問 bottom-24；現行版本另保留權限與競態修正。 |
| `src/lib/auth-rate-limits.test.ts` | 已被取代 | 實際登入 action 保留每 Email 5 次限制及其測試；不額外引入只回傳常數的 helper。 |
| `src/lib/auth-rate-limits.ts` | 已被取代 | 實際登入 action 保留每 Email 5 次限制及其測試；不額外引入只回傳常數的 helper。 |
| `src/lib/funnel-goal-step-pages.test.ts` | 已被取代 | 沿用既有 Funnel 語義核對：感謝頁、一般編輯保存 commerce、template swap 保留綁定與同步 content ref 均在主線。 |
| `src/lib/funnel-goal-step-pages.ts` | 已被取代 | 沿用既有 Funnel 語義核對：感謝頁、一般編輯保存 commerce、template swap 保留綁定與同步 content ref 均在主線。 |
| `src/lib/funnel-step-pages.test.ts` | 已被取代 | 沿用既有 Funnel 語義核對：感謝頁、一般編輯保存 commerce、template swap 保留綁定與同步 content ref 均在主線。 |
| `tests/e2e/accessibility.spec.ts` | 已被取代 | 現行使用獨立合成 ownerEmails 避免帳戶限流互相干擾；保留固定 Email 安全門檻，不導入舊整份 MFA/UI 流程。 |
| `tests/e2e/accountant-affiliate-detail-direct-url.spec.ts` | 已整合 | 現行已有相同帳號選單點擊，額外使用 exact:true。 |
| `tests/e2e/admin-cross-tenant-affiliate-edit.spec.ts` | 已被取代 | 來源改動為欄位 label；現行測試對齊目前表單並保留 foreign canary／拒絕斷言。 |
| `tests/e2e/admin-cross-tenant-video-edit.spec.ts` | 保留待做 | 依賴來源 settings/team、影片進階介面或尚未交付的 route inventory；功能交付後以現行 role/tenant 邊界適配並跑隔離 browser。 |
| `tests/e2e/commerce-orders.spec.ts` | 已被取代 | 現行 formatSanitizedAxeBlockingError 承接診斷；不恢復可能包含 DOM 內容的 failureSummary。 |
| `tests/e2e/funnel-commerce.spec.ts` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `tests/e2e/funnel-operations-transport.spec.ts` | 已整合 | 三次持久化 revision 與 dialog 關閉斷言相同；現行另驗證 HTTP、URL 及 unavailable 狀態。 |
| `tests/e2e/helpers/direct-url-guard.ts` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `tests/e2e/loading-route-segments.spec.ts` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `tests/e2e/merchant-invitation.spec.ts` | 保留待做 | 依賴來源 settings/team、影片進階介面或尚未交付的 route inventory；功能交付後以現行 role/tenant 邊界適配並跑隔離 browser。 |
| `tests/e2e/video-media-experience.spec.ts` | 保留待做 | 依賴來源 settings/team、影片進階介面或尚未交付的 route inventory；功能交付後以現行 role/tenant 邊界適配並跑隔離 browser。 |
| `tests/e2e/webinar-funnel-flow.spec.ts` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `tests/e2e/wp88-direct-url-guard-matrix.spec.ts` | 保留待做 | 依賴來源 settings/team、影片進階介面或尚未交付的 route inventory；功能交付後以現行 role/tenant 邊界適配並跑隔離 browser。 |
| `tsconfig.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `vitest.synthetic-db-coverage.config.ts` | 保留待做 | 合成 CSRF fixture 已回收；舊 tmp／support 排除規則須先對齊現行測試目錄，未直接新增 exclude。 |
| `.agents/skills/ai-team-pro/SKILL.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.agents/skills/ai-team/SKILL.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/config/routing-policy.json` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `.ai-team/mcp_server/bootstrap_probe.py` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/mcp_server/route_cli.py` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/mcp_server/routing.py` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `.ai-team/mcp_server/schemas/review-result.schema.json` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/mcp_server/test_routing.py` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `.ai-team/mcp_server/validation_runner.py` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/prompts/reviewer-prompt.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Invoke-AiTeamNodeValidation.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Invoke-AiTeamTask.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Probe-AiTeamNative.py` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Probe-AiTeamShell.py` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Start-AiTeamMcp.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Test-AiTeamBootstrap.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Test-AiTeamNodeValidation.ps1` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.ai-team/scripts/Test-AiTeamRouting.ps1` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `.codex/agents/analyst.toml` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.codex/agents/explorer.toml` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.codex/agents/planner.toml` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.codex/agents/reviewer.toml` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.codex/agents/worker-deep.toml` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `.codex/agents/worker.toml` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team-vnext-plan.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/evidence/funnel-commerce-20260917/receipt-c3a3d7fa283a.json` | 保留待做 | 歷史診斷／收據保留原路徑；下一次對應功能驗收重建新 snapshot 證據，不冒充本次 PASS。 |
| `docs/ai-team/evidence/release-baseline-sandbox-20260922.md` | 保留待做 | 歷史診斷／收據保留原路徑；下一次對應功能驗收重建新 snapshot 證據，不冒充本次 PASS。 |
| `docs/ai-team/prompts/reviewer-prompt.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `docs/ai-team/vnext-node-failure-manifest.json` | 保留待做 | 歷史診斷／收據保留原路徑；下一次對應功能驗收重建新 snapshot 證據，不冒充本次 PASS。 |
| `docs/ai-team/vnext-validation.md` | 已整合 | 本輪收尾 PR；只回收仍適用的差異，保留現行保護與 assertions。 |
| `docs/launch/goal-plan-20260924.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/launch/goal-plan-opus-recovery-20260924.json` | 保留待做 | 歷史診斷／收據保留原路徑；下一次對應功能驗收重建新 snapshot 證據，不冒充本次 PASS。 |
| `docs/launch/goal-plan-opus-response-20260924.txt` | 保留待做 | 歷史診斷／收據保留原路徑；下一次對應功能驗收重建新 snapshot 證據，不冒充本次 PASS。 |
| `docs/launch/goal-plan-opus-review-20260924.json` | 保留待做 | 歷史診斷／收據保留原路徑；下一次對應功能驗收重建新 snapshot 證據，不冒充本次 PASS。 |
| `docs/launch/goal-plan-review-status-20260924.md` | 已被取代 | 目前 AGENTS、現行非 Production runner 與本報告承接政策；舊 roadmap／release snapshot 留在來源。 |
| `docs/launch/goal-preflight-20260924.md` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `src/lib/password-reset-smoke-policy.test.ts` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |
| `src/lib/password-reset-smoke-policy.ts` | 已整合 | 來源與目前候選內容相同（僅忽略行尾及檔案末尾空白）。 |

另有 8 份新出現的模型更新證據，均保留原始內容、列入 E1：

- `docs/ai-team/evidence/model-refresh-20261005/execution.json`：保留待做／歷史證據；不當作本輪執行收據。
- `docs/ai-team/evidence/model-refresh-20261005/result.json`：保留待做／歷史證據；不當作本輪執行收據。
- `docs/ai-team/evidence/model-refresh-20261005/router-tests.json`：保留待做／歷史證據；不當作本輪執行收據。
- `docs/ai-team/evidence/model-refresh-cli160-20261005/bootstrap.json`：保留待做／歷史證據；不當作本輪執行收據。
- `docs/ai-team/evidence/model-refresh-cli160-20261005/execution.json`：保留待做／歷史證據；不當作本輪執行收據。
- `docs/ai-team/evidence/model-refresh-cli160-20261005/result.json`：保留待做／歷史證據；不當作本輪執行收據。
- `docs/ai-team/evidence/model-refresh-cli160-20261005/router_regression.json`：保留待做／歷史證據；不當作本輪執行收據。
- `docs/ai-team/evidence/model-refresh-cli160-20261005/routing_integration.json`：保留待做／歷史證據；不當作本輪執行收據。

其餘 157 筆為既有整合報告等工作產物，保留原始目錄；本輪只更新這份集中報告，不新增散落的驗收文件。原始內容、未完成來源分支及未知修改都未 reset、clean、stash、restore、覆蓋或刪除。

### 本輪驗證與團隊界線

- #367 的實際 PASS 如上；本收尾增量已跑 Python router/MCP 45 tests、PowerShell routing integration、受影響 ESLint、TypeScript。完整 GitHub `quality` 仍是合併必要條件；本報告所屬 protected PR 的 checks 與 mergeCommit 是收尾發布的最終收據，不用舊 head 綠燈代替。
- 本收尾沿用既有 push/PR ESLint、單元／coverage、PostgreSQL、Funnel harness、release browser、build gate；未新增重複 workflow、未刪除 assertions、未放寬閾值。本輪額外 browser 斷言由該 PR 的完整 browser gate 驗證。
- requested team=ai-team；#367 tenant isolation 依 canonical router 升至必要 Critical review，主代理唯一 writer，唯讀 reviewer `/root/pr367_review` selected=`gpt-6-astra high`，原因為整合 checkout 舊 Opus discovery pattern 不匹配 catalog；observed model/effort=unknown。後續 AI Team 原始修正由主代理直接處理，未啟動正在修改的 AI Team 修改自己。helper 上限 1、depth 1、dispatch 1；無全面稽核。
- 未操作 Production、真實付款／退款／寄信、破壞性 migration、secret 內容或 force push。F1–F3、Q1/Q2、A1/E1 未驗證部分明確保留，不標 PASS。

---

## 歷史紀錄（以下為各次執行當時狀態）


日期：2026-10-04（Asia/Taipei）。狀態：**五個交付段落完成 / #351、#352、#354、#355、#356 已通過新 CI、canonical gate 並合入 master；#353 的兩檔內容已由 #352 完整交付。原 42 個歷史 head 已有 15 個完成交付或替代核對，剩餘 27 個與原有未提交工作持續整合，整體 Goal 尚未全部完成**。

## 本輪已完成的段落

- 盤點初始 `master`：`bdbae2f53491afd518b97ee597e117d6a585b55c`；#351 合併後主線：`40db1781aa9d2bf17013c328a390dfecef7eee11`。分支保護已啟用，必要 GitHub check 是 `quality`；現有 CI 對每次 push 和 PR 執行 ESLint、typecheck、單元／coverage、資料庫與瀏覽器驗證，不新增重複 workflow。
- 查完 351 個 PR：334 個標記 merged，其中 315 個合併 commit 可證明在目前 master；另外 19 個是合進功能分支，不能直接當作已進 master。
- 查完 280 個即時遠端 branch heads、518 筆本機／遠端參照、115 個 worktree。詳見 [逐分支處置](branch-integration-dispositions-20261004.md) 與 [機器可讀盤點](branch-integration-audit-20261004.json)。448 筆有既有 merged PR、ancestor、patch 等價或變更面相同的證據；4 筆有新版替代或內容替代證據；66 筆（47 個獨立 head）保留待內容審核，參照數不等於獨立功能數。
- 獨立審查 PR #351 最新 head，找出並在隔離來源副本修復兩項 MAJOR：PayUni 取消 Token 補上與 setup 相同的 `CreditTokenType: 2`；正式扣款 probe workflow 移除 schedule，保留手動觸發及既有授權 guard。
- 修正有 setup→cancel 的解密契約回歸測試。本機 5 檔 Vitest **79/79 PASS**，3 個變更 TS 檔 ESLint PASS。標準修補檔對原始四檔 `git apply --check` PASS；獨立複審關閉兩項 MAJOR。
- [可套用修補檔](branch-integration-pr351-fix-20261004.patch) 與 [來源／內容雜湊](branch-integration-pr351-fix-manifest-20261004.json) 已保存。修補基準固定為 `863218bba4d64ee2f97e8db43c19583ea9fdccd8`，不能當成任意版本可套用的 patch。
- Canonical `assess_acceptance` 已以實際新 head CI run `37200997791` 重驗，[驗收紀錄](branch-integration-pr351-acceptance-20261004.json) 為 **READY**，無 blocker；targeted tests、scoped ESLint、手動觸發限制、新 head quality 與獨立 review 的收據均吻合已發布來源。#351 已透過 expected-head protected merge 合入 master。
- #211 以原 stack base 分離出自己的 288 個變更檔案：35 個已與 master 相同，187 個主線仍保留 base 狀態，66 個兩邊各自演進。已核對範圍與保留 master 的理由寫入 [衝突取捨紀錄](branch-integration-conflict-decisions-20261004.md)，其餘仍明列待辦。
- 從 #211 回收 3 個缺漏回歸測試檔，補固定時鐘後 **20/20 PASS**、ESLint PASS、patch apply check PASS。[獨立測試 patch](branch-integration-pr211-tests-20261004.patch) 與 [manifest](branch-integration-pr211-tests-manifest-20261004.json) 保存原始驗證；已建立 #352，發布進度見下表。
- #234 原作者已確認由 #236 替代；另核對四個來源檔案與替代差異，確認 #236 的 Live scope／idempotency 防護較完整，且其 merge commit 已在 master。原分支保留，處置為 `DOCUMENTED_SUPERSEDED`，不重新合併舊實作。
- #213 的原有依賴規格、override 與 lockfile 的 794 個套件版本皆已保留在主線；舊 recovery 直播預覽測試兩個案例亦已有主線對應測試，目前整檔 31/31 PASS。這兩個 head（3 筆參照）標記 `CONTENT_SUPERSEDED`，詳見 [內容替代證據](branch-integration-content-supersession-20261004.json)。
- #13 尚未保留的商品去重與名稱正規化已補成 [二檔 patch](branch-integration-pr13-preview-20261004.patch)；保留現行 API 與最多兩件的摘要行為，空白商品名改用「未命名商品」。新增三個案例，與表單測試共同 **39/39 PASS**，ESLint／apply check PASS。[manifest](branch-integration-pr13-preview-manifest-20261004.json) 保存主代理四面向審查與驗證限制；已由 #352 交付。
- 權限恢復前的遠端確認以 `bdbae2f5` 為基準；恢復後已推送 #351 修正並建立 #352／#353，進度見下表。
- 修正補丁驗證方式：先前在儲存庫子目錄直接執行的 apply check 會跳過路徑，原結果無效。三份 patch 現已從 repo root 指定隔離目錄逐檔檢查，並實際套用到新的原始來源副本；9 個輸出檔的 SHA-256 全部與已測試候選相同。[實際套用證據](branch-integration-patch-application-proof-20261004.json) 取代舊 check 結論。產品修改與測試內容未因這項更正而改變。
- 分離 #118–#135 的原 PR delta 與功能分支底層：[逐 PR 範圍與檢查](branch-integration-feature-pr-deltas-20261004.json)。正確的 reverse-check 均為 `NO_PROOF`，不能據此推定已包含或缺少；另以內容核對確認 #118 預覽測試、#121 重設密碼寄送失敗保密、#135 checkout no-store 有主線對應行為。分支整體仍保留待審，詳見 [取捨紀錄](branch-integration-conflict-decisions-20261004.md)。
- 後續已完成 #118–#135 全部 18 個自身 delta 的內容核對，保留 master 的交易隔離、租戶／manager 範圍、可信 analytics、庫存補償與歸因防護。6 個 mock 測試檔 **452/452 PASS**；相關原始檔雜湊、`actions.test.ts` 的精確審核區塊與未執行項目均記錄於同一 JSON。共用底層殘餘集中為 6 個路徑，仍待一個 sandbox QA 批次處理，因此不虛減分支待審數。

## 寫入恢復後的發布進度

使用者調整權限並明確要求繼續後，本機 Git 與 GitHub 寫入已恢復；以下為新的實際操作。先前不能寫入的記錄僅描述當時環境，不再是目前 blocker。

| PR | 已推送 head | 已完成內容 | 尚待完成 |
| --- | --- | --- | --- |
| [#351](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/351) | `ff9f446751d37be64bf2cf423e2e7c055135e0ce` | 原四檔與新增 webhook 兩檔均完成獨立審查，131 個本機測試；PR 描述已更新 | 已完成：新 CI、gate READY、取消 Draft、protected merge |
| [#352](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/352) | `e4d726fd4fefdda6c6c142349d5dce261d8d753e` | 三檔 Funnel 測試、#353 兩檔預覽修正、完整報告；已同步 master `40db1781` | 已通過新 head CI、gate READY 並 squash merge |
| [#353](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/353) | `49e884ff6870793412534e1cb22fb19cfea76a4e` | 商品去重、名稱正規化及回歸測試已納入 #352 | 已確認主線兩檔與原候選雜湊完全相同，由 #352 交付 |

#352／#353 最初基於舊 master，CI 在 Production dependency audit 失敗。#351 已含 Next.js 16.3.5→16.3.8 更新且同項稽核通過，因此已透過正常 merge 同步其已審查版本，沒有降低稽核門檻。是否完全解決仍以新 head CI 為準。

合併時使用 expected-head，保留 master 分支保護與線性歷史要求，採 squash merge；`vercel.json` 的 master 自動部署仍為 false。沒有執行正式付款、probe、正式資料庫或部署。#210／#211 在剩餘功能核對完成前保留開啟，不用關閉 PR 取代實際整合。

原 518 個參照、351 個 PR、115 個 worktree 的盤點是發布前 snapshot；新增 #352／#353 不回填成原盤點已包含的資料。完成合併後另記錄 master 與 open PR 的即時狀態。

## 本輪交付與後續批次

完整的逐 head 範圍、保留原因與驗收條件見 [未來批次明細](branch-integration-deferred-work-20261004.json)。初始尚有 42 個歷史 head。後續已核對其中 14 個由主線完整保留或替代；目前剩 28 個：Funnel 5、AI Team 2、Sandbox QA 19、staging 2。剩餘項目是待辦，並非已合併或已通過驗收。逐次核對過程與證據見後文及明細 JSON。

| 優先級／批次 | 原始工作與目前成果 | 剩餘工作、依賴與驗收條件 |
| --- | --- | --- |
| P0：#351 發布 | head `ff9f4467`；兩項 MAJOR 與新增 webhook return 增量已完成獨立複審；新 CI run `37200997791` | 已通過新 head quality、canonical gate READY 並合併；正式付款、退款、migration 與 probe 執行仍未授權。 |
| P1：Token 到期資料 | #351，`src/lib/payment-providers/payuni.ts`；既有 callback 未保存官方 `CreditLife` | 核對官方 MMYY 語義與時區，解析並傳入 `expiresAt`，明確定義缺值／錯誤格式的保守行為。測試合法月份、跨年、非法月份、已到期 Token，以及發布／quota gate 不接受過期 reference。此次不以縮小現有安全驗證解決。 |
| P1：#211 測試段落發布 | #352 回收 3 檔、20 個測試；與 #353 預覽修正整合為一個五檔產品批次 | 已在最新 master 上通過 CI 37202721735 與 gate READY，隨 #352 合併。 |
| P1：#210／#211 功能差異拆分 | #210 `b7956d80`、#211 `b5397dbb`、本機 `60132971`；主線已有 #219、#231–#240、#243–#253、#260、#263–#270 等拆分成果 | 以目前 master 為實作基準，核對 student portal、LINE rich menu、affiliate portal／分潤、成長工具與私訊等剩餘功能。舊分支相對 master 各有 216／199 個新增 src／migration 路徑，包含繼承內容，並非 #211 自己的新功能數或功能全數缺失的證明。按功能拆 PR，補齊租戶／角色／路由／資料約束及完整使用者流程，再驗收合併。 |
| P1：#211 編輯器的剩餘差異 | 已有 stack 三方分類與局部取捨矩陣；Funnel 建立、管理、public runtime、commerce、operations 與 editor 已有主線拆分 PR | 繼續核對其餘路徑；187 個未套用路徑有 177 個文件／歷史收據，不把舊收據搬成新 PASS。保留 master 最新 scope、CAS、可信價格、庫存 reservation、錯誤處理和效能改善。通過 editor→發布→匿名公開頁→mock checkout 的桌面／手機旅程；不能直接採舊分支的 migrations 覆蓋現行 migration tree。 |
| P1：主目錄未提交工程 | 原 `codex/one-stop-webinar-flow`，HEAD `60132971`；既有 AI Team vNext、Funnel、登入安全及驗證工具變更均留原位 | 每個功能先確認與 master／#351 是否重複，按 ownership 分開 checkpoint。AI Team 修改由主代理直接處理，不啟動正在修改的 AI Team 修改自己。登入與 Next.js 修改先讀相應本機文件；新增／變更測試、既有 CI 不得丟失。 |
| P2：歷史 PayUni／Staging 工作 | `codex/payuni-sandbox-external-qa`；#118–#135 自身 delta 已完成內容核對，共用底層殘餘 6 個路徑；其餘功能分支／診斷 PR 保留 | 先一次核對共用 QA runner／tests、文件、package 指令與已刪除舊 project 設定。`.env.example` 未讀取，不自動整合。再逐分支處理其餘 `remaining_paths_at_inventory`。保留新版 provider、reconciliation、歸因與隔離保護；不把舊收據冒充新候選驗證。 |
| P2：#13 預覽段落發布 | #353 已提交商品去重與名稱正規化；39 個本機測試通過；提交歷史已整合到 #352 的本機候選 | 已隨 #352 通過 CI、gate 並合併；原 #13 與 #353 保留追溯來源。 |
| P2：真實環境與營運驗收 | #351 的既有 WP1–WP6 文件保留多項外部與政策待辦 | 更新同一候選的非 Production 隔離、備份恢復、對帳、scheduler、寄送及政策 evidence。既有非 Production 授權持續有效；正式環境與真實付款操作另行授權。移除的正式 probe 自動排程不得在其他 workflow 偷渡恢復。 |

官方契約來源：[PayUni credit_bind/cancel](https://docs.payuni.com.tw/web/#/7/41)、[PayUni UPP](https://docs.payuni.com.tw/web/#/7/34)。本次 reviewer 以公開文件核對，未讀取任何帳號秘密。

## 保護、ownership 與完成定義

- 既有工作目錄唯一 dirty 的是原主目錄；原始 dirty 檔案持續保留；本輪已驗證修正在 managed worktree `branch-integration-20261004` 逐批 exact staging、提交與推送。隔離來源副本保留驗證依據。
- 主代理負責盤點、付款四檔 patch、回收三檔測試 patch、預覽二檔 patch 與報告；獨立 reviewer 只讀審查 #351 修正。requested team=`auto`；盤點 effective=`ai-team`、resolved=`gpt-6.1-sol high`；Critical review effective=`ai-team-pro`、Opus 不可用後 resolved=`gpt-6-astra high`，原因 `critical_review_no_equivalent`；observed model／effort 均為 unknown。
- agy discovery 一次失敗，記錄 `HOST_PERMISSION_BLOCKED / HOST_AUTH_CONTEXT_UNAVAILABLE`，沒有把 sandbox 無法取得登入 context 說成使用者必須重新登入。最大 active helper=1、depth=1；同一四檔只有主代理寫入。
- 回復本輪本機成果只涉及本輪新增的報告、patch 與隔離副本；不對未知修改使用 reset、clean、stash、restore、checkout 或 rebase。本輪已更新上述三個 PR 分支與描述；master 是否前進以發布紀錄為準。
- 本 Goal **尚未完成**。#351 已完成合併；其餘完整目標仍要求所有剩餘分支有已驗收合併、可證明替代、或具體保留待辦的處置；發布權限與新 CI 缺口不能寫成 PASS。

## 同時進行工作的整合紀錄

#351 的 b3ddc37b 完整 CI 已成功，但合併前 expected-head 檢查發現遠端新增 ff9f4467，包含付款後返回已登入方案頁的兩檔修改。主代理保留新提交，補做 route／test 的獨立 Critical review；沒有新增 findings。六檔相關修改的 131 個本機測試、五檔 ESLint、手動 probe workflow 限制皆通過。最終驗收採 ff9f4467 與新 CI 37200997791；沒有沿用上一個 head 綠燈直接合併。

## #351 實際合併收據

- PR：https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/351
- 已驗證 head：`ff9f446751d37be64bf2cf423e2e7c055135e0ce`
- merge commit：`40db1781aa9d2bf17013c328a390dfecef7eee11`
- 合併時間：`2026-10-04T12:33:14Z`
- 三個歷史 PayUni query heads 的相同意圖已隨此主線保留，見 [語義與 blob 證據](branch-integration-payuni-query-supersession-20261004.json)。原始分支未刪除。

## #352 實際合併收據

- PR：https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/352
- 已驗收 head：`e4d726fd4fefdda6c6c142349d5dce261d8d753e`
- merge commit：`fc28e1b8dcdba9ca3926f11d27153de048f597da`
- 合併時間：`2026-10-04T13:03:37Z`
- master：`fc28e1b8dcdba9ca3926f11d27153de048f597da`；合併 tree 與已驗收 head 完全相同。
- 必要 quality CI `37202721735` PASS，canonical gate READY；五個產品檔案與 26 份文件已交付。
- 原有 118 個可雜湊檔案與全部原始狀態條目已核對，內容與狀態均未改動；主目錄仍在原分支與原 HEAD。

## 最終遠端與保留狀態

- master：`fc28e1b8dcdba9ca3926f11d27153de048f597da`。
- 目前開啟 PR：#211, #210；兩者尚未整體合併。
- #353 已關閉為由 #352 交付；原始分支未刪除。
- 42 個歷史 head 仍依五批計畫保留；盤點與未來計畫不能當作內容已合併。
- 以上最終收據補記在本機報告；#352 提交內的文件保留提交當時的發布 snapshot。

## 後續 Goal 提示詞

```text
繼續 CelebrateDeal 的剩餘分支整合。先讀 docs/branch-integration-future-work.md、docs/branch-integration-deferred-work-20261004.json 與最新 publication／delivery-state 紀錄，重新確認 origin/master 和 open PR。以 42 個保留 head 與原有未提交工作為範圍，優先完成 P1 Funnel 與 AI Team 的可獨立驗收段落，再處理 Sandbox QA 與 staging runner。

已授權自行處理一般衝突，選擇適合目前 SaaS 架構、租戶隔離與資料安全的方案；不因例行工程選項再次詢問。逐分支核對既有主線是否已包含同一意圖，未完成工作先完成可交付段落，剩餘功能寫入未來處理報告。使用 audit 的 disposition 與實際 blob／語義證據，不只以 Git ancestry 判定。

保留未知 dirty 工作；重用乾淨隔離 worktree，僅精確 stage 本批檔案。依風險執行 targeted tests、現有 quality CI 與必要獨立審查，再經 canonical acceptance gate 與 protected squash PR 合入 master；以 expected head 與合併後內容比對留下收據。CI 已涵蓋每次 push 的 ESLint 與單元測試。

AI Team 變更由主代理處理，不啟動正在修改的 AI Team 修改自己。不要直接推 master、force push、降低驗證、讀取 .env* 或接觸正式資料。Production 部署、正式付款／退款／寄信與正式 migration 不在本 Goal 授權範圍。完成每批後更新來源、證據、剩餘範圍和下一步；不能把未執行的驗證或未整合的分支標成完成。
```

## 持續整合：LINE 草稿與 staging 診斷

- PR #354 已推送 `f73f78457b5b3059419223d0860b621b854eea90`：從 #210 完成 LINE 範本、預覽與 owner-scoped 草稿 CRUD；42 個 unit/SSR、3 個獨立 PostgreSQL 測試、TypeScript、ESLint 通過，獨立 Critical review 無剩餘 findings。CI 37206001593 與新增瀏覽器互動仍在執行，尚未合併。
- 歷史 heads `0b10ff680117`、`4fac54930808` 的兩個剩餘 runner/test 路徑已逐行比對。主線保留原診斷與非敏感分類，增加 lineage、alias、資源載入、navigation/hydration 與 session cleanup。16 個 mock contract tests 全部通過，證據見 branch-integration-staging-browser-supersession-20261004.json；兩者改列 CONTENT_SUPERSEDED，保留原分支。
- 初始 42 個保留 head 現有 2 個完成內容替代核對，剩餘 **40 個** 未完成整體驗收；#354 是 #210 的部分功能段落，不能再扣除 #210/#211 的 head 數。

### 第二次 CI 與替代證據更新

#354 最新 head 為 `026a95228d449f937e0317f6ec2aba5e5e499c95`，CI run `37206568084`。舊 head CI 在完整 unit/coverage 階段失敗；已修正 122 models／82 migrations 的 canonical inventory 相依，保留付款 adapter 固定 79→81 的拒絕範圍，獨立複審無 findings。新增 6 個 Node contract 與 5 個 Vitest tests PASS；實際 Playwright 新旅程 PASS。新 head CI 尚在執行，未合併。

另外 6 個 head（browser flow 兩個、provider read-only probe 兩個、migration apply 兩個）均逐檔核對為由現行主線替代。browser 共 16、provider 共 4、apply 共 11 個 mock contract tests PASS；沒有執行外部 staging workflow。累計 8 個 head 完成內容替代，**剩餘 34 個 head**，完整 metadata 與行為取捨分別見 `branch-integration-staging-browser-supersession-20261004.json`、`branch-integration-staging-provider-supersession-20261004.json`、`branch-integration-staging-apply-supersession-20261004.json`。

原目錄 118 檔內容雜湊與 120 筆 status 均未變動，來源 HEAD 保持 `60132971`，證據見 `branch-integration-preservation-20261004.json`。

### 當前阻擋與繼續處理

#354 的 `026a9522` CI 37206568084 仍在 unit/coverage 階段失敗，尚未合併。已啟動相同 combined-coverage runner 的本機隔離重現，僅保存 sanitized failure summary；不降低門檻、不移除案例。

歷史 smoke head `d8c85fbbb39e` 已核對只有 CI、lockfile 與隔離 smoke 文件：所有原依賴仍在現行 lockfile，Next/eslint-config-next/Vitest 已向前更新，原 CI 的驗證行為皆由現行 CI 保留，#351/#352 的實際 protected PR 交付提供 guarded-write 流程證據。來源文件留在原分支，不冒充新執行收據。累計 **9 個 head 已證明替代，剩餘 33 個**；詳见 branch-integration-historical-smoke-supersession-20261004.json。

#354 第三版 head `23fcae9871cec124cdb940a339be806081d5f849`：完整本機 4,210 Vitest tests PASS，Node TAP 找到 G7-55 清單尚未加入第 82 條 migration，精確補正後相關 11 tests PASS。Windows 本機三個 evidence hash failures 為 CRLF，已確認 Git blob 完全吻合既有 hash，無文件內容修改。独立第四次增量 review 無 findings，新 CI run `37207666809` 執行中。

歷史 migration replay head `4c44431c9769` 五檔已完成內容替代核對；主線保留隔離、checksum、history 與 cleanup contract，改善精確 rollback 與跨 collation table counts 比對。6/6 contracts PASS，未执行外部 migration。證據見 `branch-integration-staging-replay-supersession-20261004.json`，剩餘32個歷史head。

PayUni success/idempotency本機及遠端兩個head三檔內容已由master保留並強化，65/65 mock contracts PASS；API registry原98列皆保留。完整取捨及雜湊見 `branch-integration-payuni-idempotency-supersession-20261004.json`。未呼叫真實付款／退款。剩餘30個歷史head。

來源lineage及backup兩個head（`cd3571dd8184`、`f669d5b502ce`）已完成內容替代核對，40/40 contracts PASS；證據見 `branch-integration-staging-backup-lineage-supersession-20261004.json`。未執行外部DB、backup或付款操作，剩餘28個歷史head。

#354 最終候選23fcae98本機完整coverage已PASS：4,210 Vitest +1,063 Node contracts全數通過，statements64.78%、branches63.54%、functions68.28%、lines70.33%，global及src/lib門檻均通過。82 migrations fresh deploy與一次性container/temp cleanup PASS；遠端CI仍待結果。

原始120筆dirty清單重新與master逐檔比對：44檔內容已在master（僅正規化CRLF），62檔仍不同、12檔master不存在、2筆刪除／未雜湊。精確分類與hash見 `branch-integration-original-dirty-equivalence-20261004.json`；差異不代表全部都需覆蓋主線，下一輪仍須三方核對。原檔及狀態完整保留。

#211 補充核對：舊 `20260917093000_inventory_reservation_items_snapshot` SQL 與 master `20260922120000_inventory_reservation_items_snapshot` 完全同 bytes，不能重複套用。舊 landing-pages/layout.tsx 的 Puck CSS import 目前 src 尚未找到，列入下一個樣式交付段落（需實際browser驗證），詳見 `branch-integration-pr211-layout-migration-20261004.json`。

## #354 已實際合併（最終狀態）

#354 於 `2026-10-04T14:26:55Z` protected squash merge，master為 `42bce600e9c6b88003bd3b2a924d0ea96c70aee8`。PR CI `37207666809` 及push CI `37207662788` 全數成功，canonical gate READY、0 blockers；master tree `708da1b0e185a28ad31fe72e530ada363fa80541` 與已驗收head `23fcae9871cec124cdb940a339be806081d5f849` 完全一致。未降低測試、coverage或分支保護。#210/#211及28個歷史head與原dirty剩餘範圍仍進行中，Goal未標完成。

## #211 表單修復與樣式判斷更正

Puck 0.22 起由 useInjectUiCss 自動注入編輯器樣式；已查核安裝套件的實際呼叫，先前僅依 src 缺少 CSS import 判定未交付並不充分，撤回額外 import。LeadForm 的同步送出鎖確實未保留，現正補回並驗證 HTTP 失敗重試。保留較完整的現行 FormBuilder、伺服器可信 attribution 與防重複建檔，不套用舊版簡化介面或不可信 URL 歸因。

## #355 已實際合併

PR #355 的 head `24d9c7c76d6273329e2aff0b27ae9299da04d364` 已於 `2026-10-04T15:14:26Z` 經 protected squash merge，master 為 `c071b2d655b0d875fa9d616920c5a554d462dbe6`。PR CI `37210769933` 與 push CI `37210766776` 成功，canonical gate READY、0 blockers；master tree `d68ee61105387d56172e66b7425e58c31a96697d` 與驗收版本相同。交付表單防重送與重試、指定公開場次的 404 保護、管理者一頁式網站導覽，及上一批整合報告。

下一批已完整回收歷史 staging R2 binding attestation 的 4 檔，原 bytes 不變；合成契約 4/4 與 ESLint PASS，尚未呼叫外部 provider。#211 的 library/UI 九檔取捨與 50/50 targeted tests 見 branch-integration-pr211-library-decisions-20261004.json；staging target_url 原 leaf 意圖已有證據，但 eac0a343 全部分支仍未結案。原 120 筆 dirty 與 118 檔 hash 再次核對未變。

## Sandbox QA 共用層核對

19 個歷史 head 的六個共用路徑收斂為五個 runner 版本。已核對原付款／callback／query／timeout-cleanup 意圖、宣告結構、package scripts/dependencies 與 vNext policy 取代關係；付款及交接收據 33 個 Vitest tests PASS，沒有外部付款／退款。`.env.example` 只記錄 blob metadata，未讀內容。

現行正常 runner 成功時輸出 `PENDING_REFUND`，退款、資料庫狀態及冪等仍為 `pending-chrome`。已修正 QA 文件，不能以付款成功或逾時清理退款冒充完整 QA PASS。來源 `35d8f59341bc` 的 `refundThroughCelebrateDeal`、`waitForRefundPersistence`、`refundPersistencePassed`、`latestRefundableCheckout` 尚未遷移為新的固定 staging 交接消費流程；後續需驗證角色／CSRF、非 Production 綁定、單筆 processed RefundRecord 與重複退款拒絕。保留原分支，未將這 19 個 head 標成完整替代。詳見 branch-integration-sandbox-common-layer-20261004.json。


## #210 學員入口：整合前權限核對

來源 `b7956d80` 的登入、token、access route 與 dashboard 四檔已完成首輪資料邊界核對，完整來源雜湊與三項 findings 見 `branch-integration-pr210-student-portal-review-20261004.json`。尚未搬入產品程式，亦未完成整個學員入口的審查。

必須先修正：舊版用單筆訂單的 buyer support grant 換發同 Email 的整個學員 session，缺少信箱所有權驗證；整合版本應由購買完成頁導向登入，透過寄至信箱的一次性安全連結取得帳戶權限。另移除非 production action 直接回傳有效 mockLink 的分支，測試改用隔離的合成郵件收件器；token/session 補齊未來簽發時間及正值期限驗證。這些是來源靜態審查結果，不冒稱主線已暴露此入口，亦未操作真實付款或測試他人資料。

第一個完整交付段落包括信箱驗證登入、店家與學員範圍 dashboard、既有交付快照、諮詢／行事曆、優惠券及發票；新增 token model 必須以目前 migration tree 延伸，通過 disposable PostgreSQL 一次性 consume 併發測試、跨帳戶／跨店家測試及完整本機瀏覽器旅程，再經 Critical 獨立審查與新 head CI。原生課程單元／進度／證書、社群及多語／PWA 相依另外整合，不能先放入會導向不存在路由的連結。


## #356 已合併與下一段實作

#356 已於 `2026-10-04T15:41:06Z` 透過 protected squash merge 合入 `0f6cdbfa19e2bfe16c64513e85b0b4741d42f7a2`。PR CI `37212354565` 與 push CI `37212350358` 成功，canonical gate READY；master tree 與驗收 head 完全相同。來源 `860560079757` 的 parent 在 master，自身四檔 blob 全部相同，歷史待核對 28→27。未操作真實 R2。

學員入口已在 `codex/recover-student-portal-20261004` 開始恢復信箱登入與 dashboard；隔離副本的 16 個 auth/action 測試通過，實際整合初跑 31/32，尚需調整原生課程路由的階段契約、補 CSRF voucher POST、DB／browser／獨立 review 與 CI。這些是進行中狀態，不代表 #210 完成交付。


## 2026-10-05 學員入口里程碑已合併

PR #357 已於 2026-10-04T16:40:44Z 受保護 squash merge 到 `361a37da2b487bbfa17f419d7b72b9306da07c99`；accepted tree 等於 merge tree。4,270 項測試、3 項 Chromium、83 migration、完整 coverage、獨立 Critical review 及精確 head CI 皆通過，canonical gate READY。原生播放器／學習進度／證書、社群、多語言與 PWA 尚未交付，保留來源並列後續；本節更新先前「驗證中」紀錄。整體仍有 27 組歷史分支內容及原始未提交工作需要核對，不宣稱全部整合完成。


## 2026-10-05 PR358 整合完成

- PR358 已合入 master `9c45f10314faff768a33fac3f3770517b859ddce`，accepted head tree 完全一致。兩個 quality CI 與 canonical READY 通過。
- 原始 routing、portable disabled MCP 設定與分離 CI native steps 已交付。
- PR359 密碼重設測試工具 gate 繼續 CI；開發產物忽略與 Next 開發設定已建立本機 checkpoint，尚待 PR。
- 27 組歷史分支與其餘 original dirty 的語意核對仍未全部完成，不能標為整體結案。
