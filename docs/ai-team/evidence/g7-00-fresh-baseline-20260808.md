# G7-00 — Fresh product baseline and report-drift audit

## 結果

`BASELINE_ACCEPTED_WITHOUT_SCORE_CHANGE`

- UTC：`2026-08-08T00:00:26.354Z`
- Source HEAD：`1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`
- canonical total：`73.5`
- CAT04：`6.0`
- CAT10：`4.5`
- Goal：`ACTIVE`
- 本 WP canonical score delta：`0`

這是新長程 Goal 的 current-source 基線，不代表 Production、Preview、staging、PayUni、Cloudflare 或真人 release 驗收通過。

## Ownership 與 worktree

- dirty entries：`418`
- tracked modified entries：`158`
- untracked entries：`260`
- staged entries：`0`
- 所有既有 dirty entries：`PRESERVE_ONLY`
- G7-00 writer scope：僅本文件、對應 JSON receipt 與 SHA-256 sidecar。

兩份指定報告與 `prisma/schema.prisma` 均已有既存修改，因此本 WP 不改寫它們，也不把既有變更宣告為本 Goal ownership。

## 報告漂移結論

`docs/report-1-affiliate-and-course-revenue-logic.md` 保留為產品規格來源，尤其是：

- PlatformReferral、MerchantAffiliate、CourseCommission 三個 domain 分離。
- F 直接成交為 F 100%；G 成交只分 F／G，不產生 H。
- direct entry 不沿用舊推薦人。
- Stream provider usage 與 internal allocation 分離。

`docs/report-2-current-implementation-readiness.md` 只能作歷史缺口索引；目前 source 已包含：

- `PlatformReferralCode`、`PlatformReferralClick`、`PlatformReferralAttribution`、commission／ledger／payout／batch。
- `CourseCommissionAllocation`、append-only ledger 與 `CoursePayout`。
- `StreamUsageLedgerEntry` 與 `StreamUsageAllocationEntry`。

因此報告 2 中「課程 allocation／payout 尚未完成」與「缺少 Stream member/page ledger」等敘述不能直接當 current truth。後續只依 current source、schema、fresh tests、Browser、DB 與 Sandbox evidence 判斷。

## 互動角色／虛擬使用者 current truth

- 已有 `InteractionRole`、`InteractionScript`、`InteractionEvent`、角色表單、角色 workbench、timeline 與公開播放事件處理。
- 目前商家腳本 UI 的 `eventType` 仍由 hidden input 固定為 `chat_message`。
- `product_spotlight` 與 `cta_switch` 雖有後端／播放能力，但尚未形成可由商家直接選擇與預覽的完整 UI。
- 新 Goal 將互動角色列為必做，不再列為暫不做。
- 公開訊息必須透明標示官方／腳本角色；不得偽造真人觀看、報名、訂單、付款、評論或轉換數據。

## 固定功能 scorecard（provisional local baseline）

此表不取代 canonical CAT，也不具有 release 加分效力。分數採保守值；缺 Browser／Sandbox evidence 時不得假設已完成。

| 固定功能 | 基線 | 主要未閉環項目 |
| --- | ---: | --- |
| 商家 onboarding／設定 | 5.0 | persisted progress、品牌媒體、真人 owner acceptance |
| 商品管理 | 5.0 | 媒體上傳、fulfillment type、訂單連結 |
| 圖片／影片媒體 | 4.0 | R2／Stream merchant upload UI、進度、重試、預覽 |
| 直播 Studio | 5.0 | true draft、create/edit 統一、autosave、發布 revision |
| 報名表單 | 5.0 | 視覺 builder、可恢復 field errors |
| 互動角色／虛擬使用者 | 6.0 | event type selector、商品／CTA 編輯、整體預覽 |
| Email 通知 | 3.0 | 排程、delivery queue、重試、歷史、unsubscribe |
| Checkout／付款 | 6.0 | fresh Sandbox、handoff allowlist closure、完整 pending UX |
| 訂單／履約 | 2.0 | 無獨立 CommerceOrder 與全類型 fulfillment lifecycle |
| 退款／客服 | 5.0 | order reconciliation、客服 owner／SLA evidence |
| 聯盟／課程／settlement／payout | 6.0 | payout responsibility bug、外部出款／KYC／人工證據 |
| 團隊漏斗／Stream／營運後台 | 6.0 | quota exhaustion、provider reconciliation、管理 UX |

## Fresh deterministic evidence

執行：

```text
npx vitest run <20 explicit interaction/live/course/platform-referral/stream test files>
```

結果：

- Test Files：`20 passed (20)`
- Tests：`134 passed (134)`
- Exit code：`0`
- Duration：`9.67s`

本次未執行 Browser、DB、Sandbox、external provider、Production、deploy、push、merge 或正式寄信；未讀取 `.env*`、Cookie、Token、credential、正式客戶或付款資料。

## 下一個最高價值工作

`G7-01 — Launch integrity closure`

優先驗證並修正：

1. 平台 payout paid 不得代替商家 affiliate payout 把 commission 標成 paid。
2. invoice redirect checkout URL 必須通過同一 allowlist。
3. form conversion 只能更新 server-validated 的單一 click。
4. 新直播預設為 draft，且 draft 不得公開。
5. 金融與發布高風險 submit 必須有 pending、disabled、防重送與 live status。

回滾：G7-00 僅新增三個獨立 evidence artifacts，可精確移除，不涉及 schema 或產品資料。
