# G7-06 互動角色／虛擬使用者 Browser closure — 2026-08-08

## 結論

- 狀態：`PASS_LOCAL_DETERMINISTIC_BROWSER_EXTERNAL_ACCEPTANCE_PENDING`。
- 「互動角色／虛擬使用者」維持 local-evidence candidate `8/10`，已達本 Goal 的功能門檻 `>=7/10`；這次把 G7-02 尚缺的 disposable PostgreSQL、production build、desktop/mobile Browser、Axe、keyboard、pending 與 tenant evidence 補齊。
- canonical total 仍為 `73.5`、delta `0`；只有 `RELEASE-RECONCILIATION` 能把 fresh candidate 寫回 canonical CAT01～CAT10，且 CAT04／CAT10 外部／真人證據仍不能由 AI 代簽。
- Closure review 的 `2 P1 / 1 P2` 均已修正並補測；沒有未關閉 P0／P1。
- 本工作包已達可安全停下的 checkpoint；Goal 保持 `ACTIVE`，下一個最高產品價值工作為 `G7-07 — Email／通知販售閉環`。

## 實際完成的產品修正

- 公開直播不再輸出已停用角色所屬的 chat／reminder；系統事件與合法 commerce 事件仍保留。
- `product_spotlight` 只接受目前直播中可販售且已確認 fulfillment 的商品；失效、移除或跨範圍 product ID 不再被誤標為「腳本推薦」，也不會 fallback 到第一個商品造成錯誤 checkout 導流。
- stale／跨租戶角色與留言組的更新、刪除若收到 Prisma `P2025`，會回到安全清單並顯示可復原訊息，不再把原始資料庫錯誤丟給商家；未知錯誤仍照常拋出，不放寬 fail-closed。
- 失敗的 stale mutation 不寫 audit log；所有 update／delete 仍以 `id + vendorId` scope。
- Browser runner 的 pending 驗收改用穩定 test ID，在攔住 loopback server-action POST 時確認文字切換、disabled 與 `aria-busy=true`，避免以會變動的 accessible name 誤判。

## Bombmy Terra 唯讀觀察

- 已登入 Chrome 由 Terra 進行唯讀觀察，未使用 Sol；依新的 adaptive policy，後續 Chrome／Browser 任務不再固定 Terra High，而由難度選擇 `low～xhigh` 的最低足夠程度。
- 可安全確認 Bombmy 將「虛擬使用者」與「留言組」分開：前者採選擇使用者後編輯，後者有搜尋、新增、分頁、每頁筆數、綁定影片／直播資訊與項目操作；影片、商品與直播管理也採明確列表／卡片與新增入口。
- 因不得修改競品資料或進入可能接觸私人內容的編輯流程，角色 persona／頭像／啟停／草稿／發布、腳本時間軸／trigger 與實際 CTA 行為仍標記 `UNVERIFIED`，沒有臆測成競品 PASS。
- 未修改 Bombmy、未建立交易、未讀取或輸出帳密、Cookie、Token 或私人資料；只採用可泛化的互動原則，未複製品牌、文案或受保護內容。

## Fresh deterministic evidence

### Unit／component／route matrix

- `npx vitest run <19 explicit G7-06 test files>`：`19 files / 318 tests PASS`，failed `0`、skipped `0`、exit `0`。
- 覆蓋角色 normalization、事件 validation、角色／腳本 lifecycle、跨租戶 reference、published-only binding、公開透明標示、disabled role、stale product spotlight、recoverable stale mutation、Live playback source 與 auth boundary。
- `node --test scripts/g7-interaction-roles-browser-qa.test.mjs`：`6/6 PASS`；驗證 receipt fail-closed、安全 guard、source inventory、失敗診斷、穩定 pending locator 與 canonical Axe 欄位。
- Scoped ESLint：exit `0`；TypeScript `npx tsc --noEmit --pretty false --incremental false`：exit `0`。
- Scoped `git diff --check`：exit `0`；僅有 Git 的既有 LF→CRLF 提示，沒有 whitespace error。

### Production build、disposable PostgreSQL 與 Browser

- Canonical receipt：`docs/ai-team/evidence/g7-06-interaction-roles-browser-qa-058bdd7acadd7ab6.json`。
- Receipt SHA-256：`047F8E618B9487B9B0E54A9DC58FCF80AD1801FA2E2CFAAAF397612E94C8D60C`；`.sha256` sidecar 核對一致。
- Source digest：`11C6420C5ED364A10BE6DF011789A43526A0CE8340A65B2CFC5A995089652FCE`；重新計算與 receipt 一致。
- UTC：`2026-08-08T12:07:56.912Z` 至 `2026-08-08T12:10:31.773Z`。
- Temp mirror、Prisma generate／validate／migrate deploy／status、Next production build、loopback server、Playwright 全部 `PASS`。
- Browser：`4 passed / 0 failed / 0 skipped`；desktop `1440×1000`、mobile `390×844` 無水平 overflow，Axe critical/serious `0`，keyboard `PASS`。
- 驗證：角色建立／編輯／啟停、pending 防重送、四種事件、草稿／發布、preview、公開透明標示、商品 CTA 與 foreign tenant 404 全部 `PASS`。
- Desktop screenshot SHA-256：`8A360A61635F16DCBADDEB34DB516AD2115AC09081EDD53E43BEA1DBB8C1ED0B`；Mobile：`F5C604DD937387019999B2CB1D2EF2AC9B89F31D1F29D64A6D9A6B118C539181`，均與 receipt 核對一致。
- Cleanup：synthetic rows、server、container、temp root 全部 `PASS`。
- Safety：未讀 `.env*`；mirror 排除 dotenv；僅使用 loopback、PostgreSQL tmpfs、合成 fixture 與既有 Playwright browser cache；未讀使用者 Browser profile／Cookie，沒有外部或 Production mutation。

### Source attribution

- 46-entry source manifest：`docs/ai-team/evidence/g7-06-source-manifest-20260808.txt`。
- Source manifest SHA-256：`760B742D00A12702FF06A3B1DFC8C926E0A46E052FEFCB1F299B80CC85BC8D20`；46 筆重新計算 mismatch `0`。
- `docs/report-1-affiliate-and-course-revenue-logic.md` 已納入既有 Goal 的分潤 domain boundary；`docs/report-2-current-implementation-readiness.md` 已讀並只作歷史缺口索引。G7-06 判定以 fresh source、測試、DB 與 Browser evidence 為準。

## Reviewer findings 與 closure

1. `P1`：停用角色仍可能在公開直播顯示。公開序列化新增 `isActive` fail-closed filter，保留無角色的系統／commerce 事件。`CLOSED`。
2. `P1`：stale `product_spotlight` 會 fallback 到第一個直播商品並誤標「腳本推薦」，可能導向錯誤 checkout。公開頁與 client selection 均限制在當前 live product set。`CLOSED`。
3. `P2`：stale／跨租戶 update/delete ID 會暴露 raw server error。精確分類 `P2025` 並提供 recoverable redirect／alert，未知錯誤不吞掉。`CLOSED`。

## 失敗與 superseded evidence

- `04ef6526316ec20d`、`255b087b86347b86`：`2/4`，早期 Browser fixture／flow 問題；保留為失敗 receipt。
- `3417bc96430dfe4e`、`463577fc1dd919c0`：`3/4`，pending locator 使用會在 pending 時改名的 accessible name，逾時失敗；未改標 PASS。
- `85ac5afe536d020b`：`4/4 PASS` 且 source digest 與 canonical 相同，但 receipt 同時保留舊 Axe `-1` 與 observation `0` 欄位；標記 `SUPERSEDED_NOT_CANONICAL`。
- 只有 `058bdd7acadd7ab6` 同時具單一 Axe `0` acceptance 欄位、完整 source digest、hash sidecar、screenshots 與全 cleanup PASS，因此作為 canonical evidence。

## 已知限制、人工 blocker 與分數

- G7-06 本身沒有要求使用者立即手動處理的功能 blocker。
- Bombmy 深層角色 persona 與留言組 trigger 細節未驗證，屬後續競品研究增量，不影響 CelebrateDeal 現有角色／腳本核心販售閉環。
- 本 WP 的 fresh evidence 支援 candidate `8/10`，但 canonical total 仍不調整；CAT04 route-manifest terminal no-go 與 CAT10 法律／財務／客服／release 真人 owner evidence 仍需外部或真人完成，且本輪未重跑 FIN-08AA、WP-196、WP-197 的同一 endpoint／probe／失敗命令。
- AI 未代替真人法律、財務、release 或帳號授權簽核。

## Ownership、回滾與下一步

- Source HEAD：`1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`；記錄時 worktree 697 dirty entries、staged `0`。所有未知 ownership 均 `PRESERVE_ONLY`。
- 未 stage、commit、push、merge 或 deploy；未操作 Production DB、付款、退款、寄信或外部 provider mutation。
- 未降低 coverage threshold、assertion 或資料驗證；未新增 skip、exclude 或縮減 inventory。
- 回滾僅能依 46-entry manifest 與本文件列出的 G7-06 精確 hunks，反向套用 disabled-role／stale-product／recoverable-mutation／runner 修正並移除本 WP 新 evidence；禁止 reset／restore／checkout 覆蓋共享 dirty files。
- Disposable container、schema、synthetic rows、temp root 與 loopback server 均已清理，沒有正式外部狀態需要回滾。
- 下一個最高價值工作：`G7-07 — Email／通知販售閉環`；本 checkpoint 可先停下，Goal 不標記 `COMPLETE`。
