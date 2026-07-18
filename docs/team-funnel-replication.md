# 團隊展業漏斗複製：完成稽核與交接

> 稽核日期：2026-07-18
>
> 稽核基準：`eba39d8`（已合併的瀏覽器 E2E 與視覺 QA）及其團隊展業前序合併提交（#44–#54）。
> 判讀：本文件只將程式、測試或 E2E 可證實的功能列為「已完成」。這是團隊展業 Epic 的交接稽核，**不是整個 CelebrateDeal SaaS 已完成的宣告**。

## 稽核結論

本 Epic 的核心路徑已具備可驗收實作：A 建立並發佈不可變模板版本；B 經受控分享取得副本、依鎖定規則編輯與發布；公開頁安全呈現 B 的頁面與 A 的研討會；click 與報名 lead 會保存 A/B／內容／研討會歸屬快照；A 與 B 取得各自受限的成效報表。HEAD 的瀏覽器驗收涵蓋這條路徑、三種複製模式、跨租戶拒絕、過期分享與桌機／手機版面檢查。

付款成交已由 webhook 建立團隊成交歸因，退款也已反映在團隊成效讀模型。A/B 之間的佣金分配與結算，以及團隊成員／上下線關係的管理 UI，仍未落實；詳見「Remaining gaps」。

## 已完成能力與證據

| 項目 | 已驗證能力 | 程式與測試證據 |
| --- | --- | --- |
| 租戶與團隊領域 | `SalesTeam`、有效 `TeamMembership`、A→B 有效期間關係、模板版本、夥伴頁、分享設定與三類歸因 snapshot 皆為 tenant-scoped；複合關聯限制跨 vendor 連結。 | `prisma/schema.prisma`；`prisma/migrations/202607170001_team_funnel_domain/migration.sql` |
| A/B 授權 | 每次受保護操作由 session、有效 vendor membership 與有效 team membership 推導 actor；資源再以 vendor、team、所有權、直接上下線與欄位鎖定判定，缺少或不一致資料一律拒絕。 | `src/lib/team-funnel-access.ts`、`src/lib/team-funnel-access.test.ts` |
| A 模板工作台 | A 可建立原始頁與第一個不可變版本、設定欄位鎖定與商品槽、發佈後續版本、建立／停用受控分享。 | `src/app/(app)/team-templates/`、`src/app/actions/team-funnel-template-actions.ts`、`src/lib/team-funnel-pages.ts` |
| B 夥伴工作台 | B 可取得分享、建立自己的頁面、編輯未鎖定內容與自己的商品槽覆寫，並切換公開狀態；夥伴頁列表只載入本人推廣的頁面。 | `src/app/team-template/page.tsx`、`src/app/(app)/partner-pages/`、`src/app/actions/team-funnel-partner-actions.ts` |
| 三種複製模式 | `QUICK_APPLY`、`COPY_THEN_EDIT`、`BLANK_PAGE_BOUND_TO_A_WEBINAR` 均有 UI、伺服端 allowlist 與驗收；副本保留來源模板版本與 A 的內容／研討會歸屬。 | `src/lib/team-funnel-sharing.ts`、`src/components/team-template-claim.tsx`、`tests/e2e/smoke.spec.ts` |
| 動態欄位與安全文字 | 動態欄位為顯式 allowlist；缺值與不支援欄位會輸出明確文字，不能遍歷任意物件路徑。模板文字以文字處理，公開頁只輸出結構化段落／清單，不執行儲存的 markup。 | `src/lib/team-funnel-dynamic-fields.ts`、`src/lib/team-funnel-template-renderer.ts`、`src/lib/team-funnel-public-page.ts` 及相對應 tests |
| 商品槽 | 僅允許 `main_product`、`bundle_product`、`join_member`、`consultation` 四槽；優先使用 B 的安全 URL 覆寫，再回退模板商品連結，缺值明示。跨 tenant、非核准槽、未鎖定授權或含帳密／非 HTTP(S) URL 都被拒絕。 | `src/lib/team-funnel-product-slots.ts`、`src/lib/team-funnel-product-slots.test.ts` |
| 分享安全 | 分享碼含高熵隨機部分，資料庫僅存 SHA-256 hash；支援指定成員或直接下線、到期、停用與使用次數限制。領取時再次驗證 tenant、team、受眾、有效擁有者與序列化交易，失敗回傳不洩露來源的狀態。 | `src/lib/team-funnel-sharing.ts`、`src/lib/team-funnel-sharing.test.ts` |
| 公開頁 | `/p/[slug]` 只由伺服端已儲存的頁面及關聯解析；只在公開／有效分享、有效 A/B、正確 A 所屬 webinar 與有效表單、可用主商品槽都存在時渲染。 | `src/app/p/[slug]/page.tsx`、`src/components/team-funnel-public-page.tsx`、`src/lib/team-funnel-public-page.test.ts` |
| 歸因 | 公開 affiliate click 與表單提交從同源 Referer 的 B 頁及伺服端關聯解析歸屬，不信任 client 傳入 owner；query referral、有效 cookie、舊 referral 有固定優先序。click／lead 以 upsert 保存 A、B、內容擁有者、研討會擁有者、來源與 referral snapshot。結帳會把同 vendor 的 `formSubmissionId` 保存至既有訂單 metadata；paid webhook 再由該 lead snapshot 建立每筆付款一筆的團隊成交 snapshot。 | `src/app/api/affiliate-clicks/route.ts`、`src/app/api/form-submissions/route.ts`、`src/app/api/payments/checkout/route.ts`、`src/lib/team-funnel-attribution.ts`、`src/lib/payment-webhooks.ts` 及 tests |
| A/B 報表 | `/team-performance` 以頁面範圍彙整可驗證 `pageId` 的瀏覽、團隊 click、lead、已歸因成交、淨成交額與退款；A 看自己擁有模板版本的頁面，B 只看自己推廣頁面。報表有台北時區半開區間、93 天／筆數上限、延遲／缺失／截斷明示，不推估資料。 | `src/lib/team-funnel-performance.ts`、`src/components/team-performance-dashboard.tsx`、相對應 tests |
| 瀏覽器與視覺驗收 | 實際瀏覽器建立 A 原始頁、發佈版本、B 三種取得模式、鎖欄位、商品覆寫、公開頁、真實表單提交與 lead snapshot；另驗證 B 報表不顯示 A 原始頁、跨 tenant 領取拒絕、過期分享，以及 1440px／390px 無水平溢位與無 console error。 | `tests/e2e/smoke.spec.ts`（HEAD `eba39d8`） |

## Ownership matrix

此 Epic 的 A/B 是**由團隊資料與資源歸屬推導的能力模型**，不是把既有 `VendorMember.role` 改成新的 A/B enum。A 是模板／內容／研討會的擁有者，B 是其有效直接下線且擁有自己的推廣頁；所有操作仍受 vendor 邊界約束。

| 資產或行為 | A（內容／研討會擁有者） | B（推廣者） | 不相關成員／其他租戶 |
| --- | --- | --- | --- |
| 模板與版本 | 建立原始頁、發佈後續不可變版本、設定鎖定欄位與模板商品槽。 | 不可修改 A 的版本。 | 拒絕。 |
| 夥伴頁 | 可建立自己作為來源的頁面與受控分享；不能把 B 的頁面視為 A 可任意編輯的資產。 | 只可編輯、發布、分享自己的頁面，且不能改鎖定欄位。 | 拒絕／不揭露。 |
| webinar 與報名 | A 保留課程 webinar 的內容／研討會歸屬。 | B 頁保留 A webinar，但 B 為報名與 lead owner。 | 拒絕。 |
| 商品槽 | 設定模板預設商品。 | 在未鎖定時，只覆寫自己的頁面槽與安全 URL。 | 拒絕。 |
| 分享取得 | 可分享自己擁有的來源頁。 | 僅能依 token 受眾取得自身副本。 | 過期、停用、錯誤團隊或錯誤受眾均不可取得。 |
| click／lead 歸因 | 保存 leader、內容與 webinar ownership。 | 保存 promoter 與 lead ownership。 | 不能由 request 指定或跨 tenant 偽造。 |
| 報表 | 看自己所擁有模板版本的相關頁面。 | 只看本人推廣的頁面。 | 不會擴張到同儕或其他 vendor。 |

現行報表實作使用「模板內容擁有者」與「頁面推廣者」作範圍，而非一個可管理任意下線的廣義主管檢視；不要將它解讀為全隊／多層下線報表。

## 複製、欄位與商品的操作契約

| 模式 | 結果 | 不可改變的歸屬 |
| --- | --- | --- |
| 快速套用（`QUICK_APPLY`） | 複製 A 當前已發佈版本內容；B 之後可改未鎖欄位。 | A 仍為內容與 webinar owner；B 為 promoter、報名與 lead owner。 |
| 複製後編輯（`COPY_THEN_EDIT`） | 建立指定版本的 B 副本後逐項編輯未鎖欄位。 | 同上；已存在相同版本的 B 副本時回傳既有頁面，重試不重複建立。 |
| 空白頁綁定研討會（`BLANK_PAGE_BOUND_TO_A_WEBINAR`） | 文字欄位從空白開始，但仍綁定 A 的 webinar 與報名流程。 | 必須是 A 所屬 webinar；B 不得改綁他人的 webinar。 |

可在模板／B 頁文字中使用的動態欄位只包括 `partner.name`、`partner.displayName`、`partner.avatar`、`partner.phone`、`partner.email`、`partner.lineUrl`、`partner.whatsappUrl`、`partner.bio`、`partner.productUrl`、`partner.joinUrl`、`partner.referralCode`、`webinar.title`、`webinar.startAt`、`webinar.hostName`、`webinar.registrationUrl`。目前公開頁會提供其中由既有使用者、affiliate、主商品槽與 webinar 可得的值；沒有資料的 allowlisted 欄位會顯示 `[Missing …]`，不是猜測或注入內容。

## 歸因與報表邊界

```text
B 公開頁 /p/[slug]
  -> affiliate click：同源頁面 + referral/cookie 解析 -> TeamClickAttribution
  -> 公開表單：同源 Referer + 已儲存頁面解析 -> TeamLeadAttribution
      -> 同 vendor 結帳：驗證表單 cookie -> PaymentTransaction.metadata.formSubmissionId
          -> paid webhook：讀取 lead snapshot -> TeamConversionAttribution
          -> refunded / partially_refunded webhook -> RefundRecord + PaymentTransaction.refundedAmountCents
  -> 報表：pageId 範圍的 analytics view + click + lead + conversion + refund
```

- attribution snapshot 會保存當時的 team、leader、promoter、content owner、seminar owner、page、來源與 referral code；後續關係異動不會回寫既有 click／lead 資料。
- 若 query referral 是未知碼，流程不會悄悄回退舊 cookie；cookie 必須同時符合時限、server click 與 visitor id。
- 報表不是全站流量報表：沒有可信 `pageId` 的瀏覽顯示為「未回傳」，分母為零時不計轉換率，最近 15 分鐘資料標為可能延遲。
- 結帳只在 cookie 中的表單提交屬於本次 checkout vendor 時，才把 `formSubmissionId` 寫進新建訂單的 `metadata`；成功建立 checkout 後會清除此 cookie。paid webhook 會保留既有訂單 metadata 的 `formSubmissionId`（callback 未提供時採用它），並只在同一 vendor 找到對應 `TeamLeadAttribution` 時建立成交歸因，不會跨 tenant 取用 lead。
- 成交歸因以 `vendorId + paymentTransactionId` 唯一鍵 upsert：同一筆付款的 webhook 重送會更新同一份 snapshot，不會新增第二筆 `TeamConversionAttribution`。付款 webhook 亦會拒絕既有訂單的金額或幣別不一致的 paid callback；文件不將 callback 自行帶入的資料視為可覆寫既有訂單金額的來源。
- 成效的「成交」與「淨成交額」依付款交易的 `occurredAt` 落在查詢期間彙整；淨成交額為 `max(0, grossAmountCents - refundedAmountCents)`，所以退款會扣減原成交期間的淨額，但不把成交筆數改為負數。「退款筆數／退款金額」則依 `RefundRecord.processedAt` 落在查詢期間彙整，故可顯示較早成交的跨期退款；UI 明示兩種期間口徑不可再相減。

## 測試覆蓋與本次稽核狀態

| 層級 | 已追蹤證據 |
| --- | --- |
| 單元／服務 | access scope、動態欄位、模板 renderer、頁面／版本、商品槽、分享、公開頁、click／lead／paid conversion attribution、退款與 performance aggregation 皆有對應 Vitest。 |
| 元件 | A 模板表單／列表、B 取得模板、B 編輯頁、公開頁與成效儀表板皆有元件測試。 |
| 路由整合 | affiliate click、form submission 與 checkout route tests 驗證伺服端歸因連結及同 vendor `formSubmissionId` metadata；`payment-webhooks.test.ts` 驗證 paid snapshot、重送去重與跨 vendor／非付款事件不建立成交歸因。 |
| E2E／視覺 | `tests/e2e/smoke.spec.ts` 的團隊展業情境驗證實際瀏覽器工作流、資料庫結果、隔離、到期狀態、手機／桌機版面與 console error。 |

本次為文件稽核；不重新執行 `npm run test` 或 E2E，因它們的測試 fixture 會建立並清除資料，而本工作流程禁止資料刪除。允許的非刪除驗證結果會記錄於本次交接報告。

## 仍需人類填入的外部／營運資料

這些不是程式可以安全推測或代填的內容；未填時公開頁會採既有缺值狀態或無法達成發布條件。

- 商家既有的 active `VendorMember`、`SalesTeam`、A→B `TeamMembershipRelationship` 與 B 對應的 active `Affiliate`／推廣碼。
- A 確認過的模板文案、可鎖定欄位、商品槽商品與合法 checkout URL。
- A 擁有且已設定有效表單的 webinar／直播內容、排程、主辦人與公開註冊文案。
- B 的公開 slug、未鎖定頁面文案與可用的個人商品覆寫 URL；使用者名稱／email 來自既有帳號資料，其他動態個人欄位需先有受支援資料來源才會解析。
- 營運決策：分享的到期日／使用次數／指定受眾，以及付款成交、退款、佣金比例、結算與人工更正所需的可稽核規則。

## 已關閉缺口

| 原 ID | 已合併的實作 | 證據與邊界 |
| --- | --- | --- |
| TF-GAP-01 | paid webhook 已由既有訂單 metadata 的 `formSubmissionId` 對應同 vendor lead，建立可重送且去重的 `TeamConversionAttribution`。 | `src/lib/payment-webhooks.ts`；`src/lib/payment-webhooks.test.ts` 驗證 snapshot、不同 event ID 的重送仍只有一筆，以及跨 vendor／非付款事件不歸因。 |
| TF-GAP-02 | 成效頁已顯示成交、淨成交額、退款筆數與退款金額。 | `src/lib/team-funnel-performance.ts`、`src/components/team-performance-dashboard.tsx`、`src/lib/team-funnel-performance.test.ts` 驗證退款扣減與跨期退款期間口徑。這不是 A/B 佣金、payout 或結算讀模型。 |

## Remaining gaps（可追蹤）

| ID | 缺口 | 影響／完成條件 |
| --- | --- | --- |
| TF-GAP-03 | 尚無團隊 A/B 的佣金分配規則、分配紀錄、payout 或結算讀模型／流程。 | 既有聯盟佣金與退款調整不等同於 A/B 團隊佣金分配；需定義比例、可稽核調整、退款回沖、鎖帳／付款授權與驗收。 |
| TF-GAP-04 | 尚無團隊、成員與 A→B relationship 的建立／邀請／轉組管理 UI 或受控 service。 | 需定義授權者、有效期間、轉組歷史與 audit，再提供管理流程與 E2E。 |
| TF-GAP-05 | 報表僅限 A 的模板頁與 B 自己的頁，不是遞迴下線或任意全隊名單工作台。 | 若產品要求完整團隊／多層檢視、名單處理、匯出或資料遮罩，需明定 scope 並實作資料列 guard 與測試。 |
| TF-GAP-06 | 允許的動態欄位中，公開 view 目前只供應既有帳號／affiliate／商品／webinar 可得值；沒有通用的 B 個人檔案編輯與儲存來源。 | 需先決定資料最小化、驗證、公開同意與資料來源，才可啟用電話、頭像、LINE、WhatsApp、bio 等欄位。 |
| TF-GAP-07 | 本次只稽核已合併的自動化證據，未在此流程重跑會清除 fixture 的測試或 E2E。 | 在允許隔離測試資料建立與清除的環境，重新取得 CI／E2E run artifact 後可更新驗收紀錄。 |

## 證據索引

- 授權與資料隔離：`src/lib/team-funnel-access.ts`、`src/lib/team-funnel-access.test.ts`。
- 模板、版本與頁面：`src/lib/team-funnel-pages.ts`、`src/app/(app)/team-templates/`。
- B 頁與複製：`src/lib/team-funnel-sharing.ts`、`src/app/team-template/page.tsx`、`src/app/(app)/partner-pages/`。
- 商品／公開渲染：`src/lib/team-funnel-product-slots.ts`、`src/lib/team-funnel-public-page.ts`、`src/app/p/[slug]/page.tsx`。
- 歸因／付款／報表：`src/lib/team-funnel-attribution.ts`、`src/app/api/payments/checkout/route.ts`、`src/lib/payment-webhooks.ts`、`src/lib/team-funnel-performance.ts`。
- 瀏覽器驗收：`tests/e2e/smoke.spec.ts`、`tests/fixtures/team-funnel.ts`。

## Policy Blockers

- 本工作流程禁止 migration、seed、部署、資料刪除、真實付款與祕密操作；本次未執行這些動作，也未修改程式、schema 或產品行為。
- `npm run test` 與 Playwright E2E 使用會建立並清除資料的 fixture，故在本流程禁止資料刪除的條件下不執行。
