# CelebrateDeal Goal 進度

最後更新：2026-08-10 08:00（Asia/Taipei）

## 目前狀態

> 下列 branch／dirty 數字是 2026-07-25 歷史快照；current canonical readiness 以 `docs/launch/current-readiness-snapshot-20260802.json` 為準。

- 階段：Phase 5 — complete regression、CI hardening 與 Security validation
- 分支：`codex/payuni-sandbox-external-qa`
- HEAD：`35d8f59341bc`
- 基準 tracked dirty：4（`README.md`、`package-lock.json`、`playwright.config.ts`、`vitest.config.ts`）
- 目前 tracked dirty：74（包含本 Goal 的 auth/payment/webhook/tenant/provider/API/Prisma/UX/monitoring 本機 patch；均未 stage／commit）
- 目前 untracked entries：29（Goal 契約文件、既有 QA/security artifact、quality reports、local DB safety與 executable policy tests）
- 原則：既有未追蹤檔案全部視為使用者／前序任務成果，不修改、不刪除、不 stage

## 2026-08-10 current checkpoint｜G7-57

Checkout response-loss recovery P1 已關閉：vendor／product scoped idempotency key會保存在sessionStorage並綁入signed admission；425／5xx／network loss保留復原身分，成功與terminal 409清除。Server只允許相同商品的pending transaction重發admission，finished／cross-product fail closed；即使第一次request已保留最後一件庫存，有有效recovery key的買家仍可恢復，新買家維持售罄。

Final current-source targeted Vitest 5 files／22 tests、TypeScript、scoped ESLint與runner contracts 23/23 PASS。Fresh receipt `c3bd4bab4e7097f2` 通過53 migrations、production build、1/1 response-loss Browser、desktop／mobile、Axe 0、RWD與cleanup；receipt SHA-256 `F3075D15453540A6AD6D0A5D807555B4C21A31614FDA1C1597EF0D876C443464`，source lineage與目前component hash一致。Final reviewer `ACCEPT`，P0/P1/P2=0。

Checkout／付款固定功能8.8→9.2；canonical total維持75.5，CAT04=6.0、CAT10=4.5。Goal保持active，下一lane為訊息模板validation redirect後的商家草稿保存。完整證據：`docs/ai-team/evidence/g7-57-checkout-response-loss-recovery-20260810.md`。

## 2026-08-10 previous checkpoint｜G7-56

PayUni ambiguous refund outcome P1 已關閉：只有 `request_contract` 會釋放 reservation；network／provider response／authentication／unknown 會原子標記 `ambiguous:<id>` 並要求 query-only reconciliation。`request:<id>` 視為可能仍在 provider call 中，no-refund query 一律 fail closed；action completion 與 reconciliation 都有 exact state ownership mutation，pending 時 dashboard 不提供第二次退款。

第一輪 reviewer 找到 in-flight race 後已完成修正；第二輪 final reviewer `ACCEPT`，P0/P1=0。4 files／240 targeted tests、TypeScript、scoped ESLint、53 migrations／3/3 disposable PostgreSQL、controlled production build與cleanup全PASS。失敗的 DB marker receipt及 build receipt `EEXIST` 路徑如實保留。

退款／客服固定功能8.7→9.0；canonical total維持75.5，CAT04=6.0、CAT10=4.5。Goal保持active，下一lane為 checkout commit後response-loss recovery／idempotency P1。完整證據：`docs/ai-team/evidence/g7-56-payuni-ambiguous-refund-closure-20260810.md`。

## 2026-08-10 previous checkpoint｜G7-55

Email 寄送營運已新增 vendor-scoped exact hash／ID 搜尋、狀態／通知類型篩選、每頁25筆分頁、安全 durable requeue、永久拒絕 fail-closed、audit 與 stale-result 明示。

最新驗證：53 migrations、4/4 disposable PostgreSQL、10 files／40 targeted tests、runner contracts 6/6、TypeScript、scoped ESLint與受控 production build通過。Goal恢復後最新 Browser receipt `5e2da0dbc2398ef6` 仍為2/5；再次定位到fixture filter與expected row矛盾，runner已修且contract 6/6，但沒有第三次重跑完整Browser。

Email固定功能8.2→8.6；canonical total維持75.5，CAT04=6.0、CAT10=4.5。完整報告：`docs/ai-team/evidence/g7-55-email-merchant-operations-20260810.md`。

## 2026-08-10 current checkpoint｜G7-54

報名名單已新增安全搜尋、驗證／來源篩選、每頁25筆分頁、清除條件、桌機表格與手機卡片；PII不進URL，route與action都重新驗證vendor。Browser抓到`name="reset"`遮蔽原生form reset的實際bug，已修成`resetFilters`。大型名單效能P2以`pg_trgm`及三個GIN indexes關閉。

最新驗證：6 files／18 targeted tests、runner／index contracts 13/13、89-model／52-migration inventory、TypeScript、scoped ESLint、production build、5/5 Browser、desktop／mobile、Axe 0、keyboard、loading、CSRF error、tenant noindex／no-leak與cleanup全PASS。Final reviewer `ELIGIBLE`。

報名表單固定功能8.7→9.1；canonical total維持75.5，CAT04=6.0、CAT10=4.5。Goal保持active，下一lane為Email merchant operations。

## 2026-08-10 previous checkpoint｜G7-53

報名表單草稿復原與版本衝突保護已完成：tenant／form scoped瀏覽器草稿支援自動保存、恢復、捨棄、成功後清除與一般server failure後復原；編輯儲存使用`updatedAt` CAS，舊分頁不會覆蓋新版，stale草稿不提供直接恢復。

最新驗證：13 files／73 targeted tests、runner 11/11、TypeScript、scoped ESLint、51 migrations、production build、9/9 Browser、same-browser cross-tenant、desktop／mobile、Axe 0與cleanup全PASS。Final reviewer `ELIGIBLE_NO_P0_P1_P2`。

報名表單固定功能8.2→8.7；canonical total維持75.5，CAT04=6.0、CAT10=4.5。Goal保持active，外部／真人blocker繼續跳過，下一 lane 為 Email merchant operations 產品缺口。

## 2026-08-09 current checkpoint｜G7-23

Live reminder durable reconciliation 已完成：既有 VERIFIED registrations 在 schedule、template、offset、status、title 改動後可安全重排；A→B→A 只恢復未寄出 revision，stale schedule／title worker 由 Serializable current-config guard 阻擋，unchanged current reminder 可正常進入 provider stub。

最新驗證：6 files／242 targeted tests、46 migrations／8 disposable PostgreSQL tests、TypeScript、scoped ESLint、controlled production build與 final reviewer `NO_P0_P1_FINAL` 全 PASS。沒有執行真實 Email、Production cron、staging／PayUni Sandbox 或正式環境操作。

Email 固定功能 7.8→8.2；CAT01 7.5→8.0；canonical total 73.5→74.0。CAT04=6.0、CAT10=4.5，Goal 保持 active，外部／真人 blocker 繼續跳過，下一 lane 仍為產品功能 P1 掃描。

## 2026-08-08 current checkpoint｜FIN-2026-08-08-84

本段落已完成 affiliate commission payout 的 paid outcome reference 閉環：paid transition 要求 1～200 字人工出款／provider reference，寫入 AffiliatePayout 與 audit snapshot，affiliate commission page 顯示 reference，void 清除 reference；歷史缺漏保留 null。

最新驗證：action／affiliate page 2 files、160/160 tests；affiliate payout PostgreSQL disposable suite 3/3；34 migrations validate/deploy/status 與 marker cleanup PASS；Prisma validate/generate、scoped ESLint、TypeScript、production build 89/89 static pages、diff-check PASS。此段落的本機 runner／append-only cleanup 診斷均已如實記錄，未把失敗嘗試算入 PASS。

Canonical total 維持 73.5，CAT04=6.0、CAT10=4.5、SANDBOX_READY=false、PRODUCTION_READY=false、current_goal_score_change=0。這是 local finance P1 closure，不等同 CAT04 staging／PayUni Sandbox 或 CAT10 真人／monitoring acceptance；本段落完成後停止，不自動重試 FIN-08AA、WP-196、WP-197。

## 已完成里程碑

- [x] 完整讀取 `CELEBRATEDEAL_PLAN.md` 與 `GOAL_RUNBOOK.md`
- [x] 確認執行環境為 Windows 原生 PowerShell
- [x] 確認 Node、npm、PostgreSQL 18、Playwright、Chrome 可用
- [x] 確認目前沒有殘留 Next／Playwright 程序、31023 listener 或 `.next/lock`
- [x] 以中繼資料確認目前 E2E 的 `DATABASE_URL`／`DIRECT_URL` 均為 loopback 且資料庫名稱屬於 dev/test
- [x] 建立 canonical 報告骨架與基準分數
- [x] 將 Vitest／Playwright DB boundary 改為 fail-closed
- [x] 10 個 DB safety 單元案例通過
- [x] 三次連續 release E2E（各 25/25）→ owned process 0 → listener 0 → lock false → build 通過
- [x] PostCSS 由 8.5.16 更新至 8.5.23，`npm audit --omit=dev` 為 0
- [x] 完整 lint、雙 typecheck、109 test files／857 tests、backup static checks 通過
- [x] README 校正為 Windows 原生已驗證路徑，WSL 保留為替代路徑
- [x] 續跑基準校正：確認 Windows、Node/npm、Playwright、Chrome 與 PostgreSQL 18 絕對路徑狀態
- [ ] Codex Security standard scan 正在驗證 66 個候選 finding；目前無 confirmed defect，候選仍不可當成漏洞
- [x] 將 Codex Security candidate pool 分布寫入 raw quality artifact，避免把候選誤判為 confirmed defect
- [x] 驗證並本機修正 MFA recovery code conditional claim 與 backslash redirect fallback；targeted unit 通過
- [x] 驗證並本機修正 late callback state regression、refund amount/currency/remaining invariants 與 webhook retry atomic claim
- [x] 將 affiliate commission 建立移入 payment SERIALIZABLE transaction，並在 transaction 內重新判斷 logical order
- [x] Payment/refund/webhook targeted regression 4 files／124 tests、typecheck、lint 通過
- [x] 本批 8 個 security-sensitive files secret scan 0 個可行動 finding
- [x] 修正停用 VendorMember attribution、跨租戶 visitor ID、duplicate lead attribution、失效頁面與 webinar lifecycle
- [x] 修正同團隊其他成員 webinar binding 與 inactive product checkout exposure
- [x] Authorization/tenant targeted regression 6 files／68 tests、typecheck、lint 通過
- [x] 本批 12 個 security-sensitive files secret scan 0 findings
- [x] 修正 Cloudflare stale callback 單調狀態轉移與 conditional claim；pure state tests 8/8 通過
- [x] 移除 vendor 表單對 provider-owned UID／playback／ready/status 的寫入能力
- [x] Cloudflare provider trust targeted regression 4 files／110 tests、typecheck、lint 通過
- [x] 建立只綁定 loopback 的 temporary PostgreSQL 18 isolated cluster，套用 8 個 migrations
- [x] password reset sequential／concurrent consume DB regression 通過
- [x] payment concurrency／late callback／over-refund DB regression 通過
- [x] Cloudflare stale callback／error recovery DB route regression 通過
- [x] 建立 27/27 route 的 API contract registry，並以 executable inventory test 防止新增 route 漏列
- [x] 建立 51/51 Prisma model、9/9 migration invariant inventory
- [x] form deterministic-ID concurrent submission 於 isolated PostgreSQL 通過，最終資料列維持一筆
- [x] 以 zero-mismatch aggregate 證明本機資料可安全套用 tenant-ledger composite FK migration
- [x] Refund／AffiliateCommission／AffiliatePayout／PayoutItem 的跨 tenant binding 均由 isolated PostgreSQL `P2003` 拒絕
- [x] payment webhook scope 與 transaction re-read 改為 vendor/provider/order 三者一致；cross-provider order collision regression 通過
- [x] Windows release-mode axe／keyboard／focus／reduced-motion／mobile target 8/8 通過，含 31 個 static owner routes、14 個 dynamic commerce routes 與 platform-admin MFA／operations
- [x] 固定 account routes、authenticated dashboard 與公開直播導購頁 performance budget 3/3 通過
- [x] 完整 release browser suite 35/35 通過，且結束後 listener／owned process／`.next/lock` 全為零
- [x] GitHub Actions candidate 加入 production audit、safe secret/archive scan 與完整 release browser Gate（尚待獲授權 push 後取得 runner 證據）
- [x] 修正 password reset／inventory concurrency 的 Prisma transaction admission `P2028`；完整 regression 通過
- [x] 建立完整來源分母的 V8 coverage Gate；global 63/57/60/65 與 `src/lib` 86/80/88/88 thresholds 全數通過
- [x] 建立 27 項 requirements-to-implementation-to-test traceability matrix；人工 Gate 與產品決策不冒充自動通過
- [x] 建立 TypeScript AST architecture Gate；domain→UI 反向依賴 0、API→component 0、runtime cycle 0，並對 2,272-line root actions 設 debt ceiling
- [x] 校正 README 的 Windows release Gate，建立 current/runbook/historical/research 文件權威與時效地圖
- [x] 建立 repository hygiene Gate：tracked runtime/secret/archive=0、production debt marker=0、focused tests=0、ignore policy 鎖定
- [x] 建立 type-safety policy Gate：strict/noEmit/isolatedModules、Production suppression=0、explicit `any`=0
- [x] 啟用獨立 Production `noUncheckedIndexedAccess` Gate，修正 13 個檔案的 index/destructure 風險；241 tests、lint、雙 typecheck 通過
- [x] 不降低門檻地補回 strict-index hardening 造成的 coverage 微幅回歸；109/109 files、857/857 tests 與 8 項 threshold 全數通過
- [x] 完成 strict-index 後 Windows release regression：35/35 browser、clean teardown、production build、lint、雙 typecheck、audit、secret scan、PS7/PS5 backup static 全綠
- [x] 將 Dashboard onboarding 改為五個可執行下一步，補近期直播／排程／聯盟來源空狀態
- [x] 修正直播建立頁 4/8 步文案不一致、未填必填欄位仍可跳步、invalid control 無可見回饋與未驗證串流宣稱
- [x] 共用 Submit／Danger button 補 pending、disabled、`aria-busy` 與 live status，避免重複送出
- [x] UX 收斂後完整 release browser 38/38、unit/coverage 110 files／862 tests、72-route build 與全套 static/security gates 通過

## 目前 findings

1. 已關閉：Vitest／Playwright DB isolation 已 fail-closed。
2. 已關閉：三次連續 E2E→cleanup→build 證明 Playwright Windows teardown 正常；前序 evidence 較符合「命令仍在執行」而非穩定 orphan defect。
3. 已關閉：README 已校正 Windows/WSL 說明。
4. 待進行：全 route × role × tenant threat model 與 BOLA/IDOR 負向矩陣。
5. 複審中：Codex Security backend manifest 已 completed/sealed；GUI queue 顯示的 66 項收斂為 final 52 個 reportable medium-confidence findings，仍需與目前 dirty fixes 逐項交叉核對。
6. 待確認：PostgreSQL 18 client tools 不在目前 PATH；可透過已知絕對路徑使用，後續 Windows preflight 需將此差異明確化。
7. 已修正並完成 isolated DB 回歸：password reset token consume race；MFA recovery code replay race與 backslash redirect 已 targeted regression。
8. 已修正並完成 isolated DB 回歸：late callback state monotonicity、refund invariants、logical-order/commission concurrency。
9. 已修正且 targeted regression 通過：Webhook retry atomic claim 與 route failure guard。
10. 已修正且 targeted regression 通過：inactive member attribution、vendor-scoped visitor ID、duplicate lead attribution、page/live lifecycle、inactive product exposure。
11. 已修正待 E2E：同團隊其他成員 webinar binding。
12. 已修正同團隊模板 edit read IDOR，並以 page query regression 鎖定 content owner／webinar owner scope。
13. Needs Decision：公開 Email、anonymous analytics anti-spoofing，以及 referral source proof model；完整選項已寫入 `DECISIONS_NEEDED.md`。
14. 已建立 27 API routes／47 server actions 的 route×role×tenant×MFA matrix；所有 route 有同路徑測試、所有 actions 有 CSRF guard。
15. 已修正 form/click/analytics 的 public live lifecycle 與 product-click binding；3 files／23 tests 通過。
16. 已修正 Cloudflare ready state 被 stale callback 降級，以及 vendor 表單可偽造 provider UID/state；pure/action/component targeted regression 通過。
17. 已建立 API contract registry 與 Prisma invariant inventory；27 routes、51 models、9 migrations 皆有 executable coverage。
18. 已在 isolated DB 套用 tenant-ledger composite FK migration；DB-I03～DB-I05 本機 negative regression 通過，外部 aggregate preflight 與 migration 授權仍待完成。
19. 已補 form concurrent duplicate regression；兩個並行 request 收斂為單一 DB row。
20. 已修正 scoped payment webhook 忽略 provider identity；相同 vendor/order 的其他 provider transaction 不再被誤更新。
21. 已修正登入／Dashboard contrast、桌面側欄遮擋、44px target、skip link、icon control accessible name 與 reduced-motion；axe 5/5 通過。
22. 已建立固定路徑 performance gate；account routes、authenticated dashboard 與公開直播導購頁 3/3 通過。
23. 已修正 monitoring 將原始 error/message/context 傳給 console／Sentry 的風險；現在只輸出安全 category、allowlisted code/context，exclusion tests 通過。
24. 已讓公開直播 lifecycle fail closed：draft 與未開 replay 的 ended 不公開，停用商品／表單不曝光，狀態與 CTA 失敗回饋具可見語意。
25. 完整 release suite 首輪以 axe 找到 invalid `aria-controls`；修正後 targeted 1/1 與完整 39/39 通過。

## 下一個動作

1. 將 Codex Security final 52 個 reportable findings 與目前 dirty fixes 逐項對照，只處理具檔案、行號與可重現證據的 finding。
2. 補上 webinar binding 的 release E2E negative regression。
3. 釐清 DB-I01／DB-I02 唯一性語意，並為 DB-I06／DB-I07 建立只讀 mismatch preflight；未取得證據前不擴大 migration。
4. analytics/referral/公開 Email、商家停權與直播模板／常駐 preview 等待產品決策，不以猜測改動。
5. 保留 screen-reader、field CWV 與外部服務簽核為明確人工證據。

## Quality Gates

| Gate | 狀態 | 證據 |
|---|---|---|
| Windows preflight | 通過 | `reports/quality/20260724T171800098Z-preflight.md` |
| Local DB isolation metadata | 通過（當下） | loopback=true、safe DB name=true |
| Deterministic E2E/build | 通過 | 三次 25/25 E2E＋cleanup＋build |
| Static/unit | 通過 | lint、雙 typecheck、112 files／880 tests；完整來源 coverage threshold 通過 |
| Supply chain | 通過（Production） | production audit=0；dev-only ESLint/minimatch upstream exception 已記錄 |
| Backup tooling static | 通過 | `backup_tooling_static_checks_passed` |
| Secret safety | 通過（本輪輸出） | 僅記錄 boolean／enum |
| Production/external writes | 未執行 | 本輪只讀 |
| Codex Security standard scan | 掃描完成／複審中 | final 52 reportable findings；High 25／Medium 12／Low 15；medium confidence |
| Payment/refund/webhook targeted | 通過 | 4 files／124 tests＋typecheck＋lint |
| Isolated DB security regression | 通過 | PostgreSQL 18 loopback-only；3 files／45 tests |
| API／Prisma executable inventory | 通過 | 27 routes、51 models、9 migrations |
| Form concurrent duplicate | 通過 | isolated DB；單一 row invariant |
| Tenant-ledger composite FK | 通過（本機候選） | 4 same-tenant writes＋4 cross-tenant `P2003`；外部 migration 未執行 |
| Authorization/tenant targeted | 通過 | 6 files／68 tests＋typecheck＋lint |
| Team template edit ownership | 通過 | 1 file／1 test＋typecheck＋lint |
| Public lifecycle／analytics binding | 通過 | 3 files／23 tests＋typecheck＋lint |
| Cloudflare provider trust | 通過（自動化） | pure state 8/8；action/component batch 4 files／110 tests；DB route included in 45/45 |
| Windows release browser | 通過 | Chromium 39/39；28 smoke＋8 accessibility＋3 performance；cleanup 0 listener/lock |
| Fixed-route performance | 通過（目前固定路徑） | release Chromium 3/3；account routes＋authenticated dashboard＋public live commerce budgets |

## 最低分項目

- G05 外部服務：50
- M05 Email/Sentry/PostHog：70
- F01 商家 onboarding：75
- F02 建立與發布直播：78
- Q22 直播導購商業化：78
- G03 Supabase Data API：78
- Q19 設定/env/secrets：80

## Manual Exceptions

詳見 `MANUAL_ACTIONS.md`。目前包括 Supabase residual ACL、PayUni Production、Sentry delivery、Cloudflare exact binding、PostHog Production 與 screen-reader。

## Recovery

- 若 E2E 失敗，只終止本輪建立且 command line 可證明屬於本 repo 的精確 PID。
- 不使用廣域 `taskkill /IM node.exe`。
- 不刪除 `.next`；若遇 lock，先確認 owner PID，再做精確處置。
- 不 reset、checkout、clean 或覆寫既有未追蹤 artifacts。
- Phase 1 未使用任何手工 kill；Playwright 1.61 原生 teardown 三次正常。
- 續跑時以 `reports/quality/20260725T094618Z-continuation-baseline.md` 作為目前狀態基準。
