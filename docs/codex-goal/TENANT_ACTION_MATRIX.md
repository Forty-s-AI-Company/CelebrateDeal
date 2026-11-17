# 兩租戶 action 矩陣盤點（R-05／F-134 第二批，2026-11-17）

盤點對象是 `master`（`b552cd44`）上每一個 `"use server"` 檔 export 的 Server Action，以及 `src/app/api/**/route.ts` 中接受 ID 的 handler。每一列回答三件事：是否接受外部 ID、ID 是否在最後一次 DB 讀寫綁定目前 vendor（或夥伴／買家自己的授權），以及是否已有**真實 PostgreSQL** 的第二租戶回歸測試。

- 「db」：真實 PostgreSQL、用商家 A 身分帶商家 B 的 ID，斷言拒絕且兩邊資料不變。
- 「lib db」：同上，但測的是 action 呼叫的 `src/lib` 服務，不經過 action 本身。
- 「mock」：只有 mock prisma 的測試（例如斷言 `where` 帶 vendorId），不算 DB 層回歸。
- 「本 PR」：本批新增，見 `src/app/actions/two-tenant-actions-money-pii.db.test.ts`。

## 結論

- **沒有發現租戶漏洞。** 每個以商家、夥伴或買家身分執行、接受外部 ID 的 action 與 route，最後的 DB 操作都綁定 session 的 vendor，或綁定夥伴／買家自己的授權。只用 id 查詢的地方都屬於兩種情況：平台管理員 action（`requireFinanceAdmin`，設計上跨租戶），或 id 來自同一交易內先以 vendorId 查到的結果。
- Server Action：231 個 export。其中 40 個是 `src/app/actions.ts` 對 `src/app/actions/*` 的轉出口，實作共 191 個。
- 以商家／夥伴／買家身分執行且接受外部 ID 的 action 共 123 個：
  - 本 PR 前已有 db／lib db 回歸：56 個；另有 2 個部分涵蓋（`upsertLiveAction` 只測別家商品，`landingPageAction` 只測 save／check_publish）。
  - **本 PR 新增：30 個**，涵蓋全部金流、佣金、退款與個資類（另加 3 個 route）。
  - 仍未有 DB 層回歸：35 個，其中 1 個 n.a.（`selectBillingPlanAction` 的方案是平台共用目錄）、1 個個資類只有 mock（`upsertFormBuilderAction`），其餘 33 個是內容與設定類，見最後一節。
- API route：116 個。46 個 job／ops／admin（secret 保護，無租戶 actor）、5 個 provider webhook（簽章）、34 個公開路由（含 3 個 viewer／講師雙模式）、31 個需要商家或買家身分。後者中 28 個接受外部 ID：本 PR 前 2 個有 lib db 回歸、本 PR 新增 3 個、其餘 23 個只有 mock 或無測試。

## 本 PR 新增（全部真實 PostgreSQL）

每一列都同時有「本商家 ID 可以成功」的對照列，證明拒絕來自租戶邊界而不是表單錯誤；外商家列另外斷言兩個租戶的資料快照完全不變、付款 provider 沒被呼叫、沒有排信。

| 類別 | action／route | 外商家 ID 的結果 |
| --- | --- | --- |
| 金流 | `payInvoiceAction` | `/billing/invoices?error=invalid_invoice`，與不存在的 ID 相同 |
| 金流 | `revokePaymentMethodReferenceAction` | `?error=invalid_reference`，與不存在的 ID 相同 |
| 金流 | `startPaymentMethodSetupAction`（MEMBERSHIP，B 的 team 或 B 的 membership） | `?error=invalid_scope` |
| 金流 | `grantCommerceEntitlementAction`（B 的訂單，或 A 的訂單號配 B 的權益） | `?error=fulfillment_conflict` |
| 金流 | `transitionServiceFulfillmentAction` | `?error=fulfillment_conflict` |
| 金流 | `transitionShippingFulfillmentAction`、`POST /api/orders/shipping` | `?error=fulfillment_conflict`；route 對外商家與不存在的出貨回同一個 303 |
| 退款 | `requestSupportRefundHandoffAction`（B 的已付款訂單） | `?error=refund_unavailable` |
| 退款 | `reviewSupportRefundHandoffAction`（平台財務用 B 的退款完成 A 的申請） | `?error=refund_unavailable`；用 A 自己的退款則完成 |
| 佣金 | `upsertAffiliateAction`（改 B 的佣金率與聯絡信箱） | P2025，與不存在的 ID 相同 |
| 佣金 | `setAffiliatePortalAccessAction`（B 的推廣者、B 的成員、撤銷 B 的授權） | `?error=conflict` |
| 金流 | `upsertProductAction`、`POST /api/products/upsert`（改 B 的商品價格） | `not_found`；route 404 |
| 直播銷售 | `startLiveInteractionAction`、`drawLiveInteractionWinnerAction`、`verifyLuckyDrawWinnerClaimAction`（含 B 真正的核銷碼） | 與「不存在」相同的錯誤訊息 |
| 個資 | `createSupportCaseAction`、`addSupportCaseNoteAction`、`assignSupportCaseAction`（雙向）、`transitionSupportCaseAction`、`addSupportCaseCustomerReplyAction` | `support_create`／`case_conflict`／`invalid_transition` |
| 個資 | `createBuyerSupportCaseAction`、`addBuyerSupportReplyAction`、`enterStudentPortalFromCheckoutAction`（持 A 的買家 cookie 帶 B 的 grant 或案件） | `/support/requests?error=unavailable`、`/checkout/result` |
| 個資 | `cancelConsultationBookingAction`、`updateConsultationBookingStatusAction` | `/consultations?error=not_found_or_closed` |
| 個資 | `updateCustomerStatusAction`、`removeCustomerTagAction` | `customer_not_in_selected_project` |
| 個資 | `unblockBlacklistAction` | P2025，與不存在的 ID 相同 |
| 個資 | `manageEmailDeliveriesAction`（重送 B 的信、搜尋 B 的寄送編號） | 「找不到這筆寄送紀錄」、0 筆 |
| 個資 | `moderateLiveQuestionAction` | 「問題不存在，或不允許這個狀態轉換。」 |
| 個資＋營收 | `readFunnelOperations`、`GET /api/funnel/operations/reports` | 「找不到一頁式網站或沒有存取權限。」；route 404 `UNAVAILABLE` |

驗證過測試真的會抓到漏洞：暫時把 `payInvoiceAction`、`cancelConsultationBookingAction`、`unblockBlacklistAction` 的 vendorId 條件拿掉，對應的外商家列與「外商家與不存在 ID 不可區分」測試都會失敗；還原後全數通過。

## 已有 DB 層回歸（本 PR 前）

| 類別 | action | 測試 |
| --- | --- | --- |
| 佣金／出款 | `recordAffiliatePayoutOutcomeAction`、`saveMerchantAffiliatePayoutPolicyAction` | `two-tenant-actions.db.test.ts`（#464） |
| 佣金 | `saveMerchantAffiliatePolicyAction` | lib db `merchant-affiliate-policy.db.test.ts` |
| 佣金 | `setTeamMembershipAffiliateAction` | `team-membership-affiliate-binding.db.test.ts` |
| 佣金 | `submitAffiliatePayeeProfileAction`、`createAffiliateRemunerationQuoteAction`、`signAffiliateRemunerationQuoteAction`、`approveAffiliatePayeeProfileAction` | lib db `affiliate-remuneration.db.test.ts` |
| 金流 | `saveVendorPayoutAccountAction` | `billing/payouts/actions.db.test.ts` |
| 金流 | `createProductQuickAction` | `live-resource-quick-create.db.test.ts` |
| 金流／個資 | `grantCustomerVoucherAction`、`saveConsultantNoteAction`、`addCustomerTagAction`、`searchCustomersAction` | `customer-crm-actions.db.test.ts` |
| 個資 | `searchFormSubmissionsAction` | #464 矩陣 |
| 個資 | `saveMobileConsultationAction` | `mobile-consultation-actions.db.test.ts` |
| 個資 | `requestMagicLinkAction` | `student-portal-checkout-journey.db.test.ts` |
| 權限 | `vendor-member-actions` 5 個、`team-membership-actions` 4 個 | #464 矩陣 |
| 權限 | `acceptVendorMemberInvitationAction`、`switchFromSuspendedVendorAction` | `vendor-member-invitation.db.test.ts`、`vendor-suspension.db.test.ts` |
| 內容 | `funnel-automation-actions` 4 個 | #464 矩陣 |
| 內容 | `automation-actions` 的 toggle／delete／create／update／delete step | `automation-voucher-line-notification.db.test.ts`、`automation-line-push-policy.db.test.ts` |
| 內容 | `landing-page-template-actions` 7 個 | `landing-page-template-actions.db.test.ts` |
| 內容 | 課程章節與單元 5 個、`moderateCourseCommunityAction` | lib db `course-curriculum`、`course-chapter-manage`、`student-course-learning`、`course-community` |
| 內容 | `email-sequence-actions` 4 個 | lib db `email-sequences.db.test.ts` |
| 內容 | `updateRichMenuDraftAction`、`createRegistrationFormQuickAction`、`listLiveInteractionScriptsAction` | 各自的 db test |
| route | `affiliates/[affiliateId]/remuneration/[snapshotId]/export`、`live-chat/instructor` | lib db（route 本身只有 mock） |
| 公開 route | `form-submissions`、`live-interactions`、`live-watch-link` | route 層 db test |

不適用（不接受外部 ID，或只用 session 自己的 user／vendor）：登入、密碼、MFA、session 撤銷 13 個；onboarding、追蹤設定、品牌以外的設定類；`createSalesTeamAction`、`createConsultationEventAction`、`importSystemRolesAction`、`upsertBlacklistAction` 等只建立在 session vendor 底下的 action；平台管理員 action（月結、出款批次、退款、webhook 重送、凍結商家、平台推薦出款、Beta 功能授權、帳號安全、Stream 對帳、`voidAffiliateCommissionAction`、`recordCoursePayoutOutcomeAction`），其 vendor 角色被拒有 `src/lib/auth.test.ts` 回歸。

## 仍未涵蓋（內容與設定類，留下一批）

這些 action 都已綁定 vendor（見上方結論），缺的只是 DB 層回歸；多數已有 mock 層的別家 ID 案例。

| action／route | 現況 |
| --- | --- |
| `upsertFormBuilderAction`（報名表欄位，個資相關設定） | mock「scopes edits to the authenticated vendor」 |
| `upsertLiveAction` | db 只測別家商品；別家 live id、表單、影片等為 mock |
| `landingPageAction` | db 只測 save／check_publish；其他操作為 lib mock |
| `upsertInteractionRoleAction`／`…State`、`deleteInteractionRoleAction`、`upsertInteractionScriptAction`（含 `saveInteractionScript`）、`unbindInteractionScriptFromLiveAction`、`duplicateInteractionScriptAction`、`deleteInteractionScriptAction`、`endLiveInteractionAction` | mock |
| `getLivePollStudioSnapshotAction` | 無測試（唯讀，查詢帶 vendorId） |
| `upsertVideoAction`、`archiveVideoAction`、`upsertFormAction` | mock |
| `restoreVideoAction`、`upsertTemplateAction` | 無 |
| `createAutomationRecipeAction` | 無；`dryRunAutomationRuleAction`、`createAutomationRuleAction` 為 mock |
| `updateEvergreenWebinarSettingsAction`、`updateConsultationEventAction`、`toggleConsultationEventAction` | mock |
| `updateFunnelOperations`、`saveBrandSettingsAction`／`…State` | mock |
| `selectSalesProjectAction`、`publishSalesProjectAction` | 無 |
| `createTeamLiveShareAction`、`claimTeamTemplateAction`、`manageTeamFunnelTemplateAction`、`savePartnerPageAction` | lib mock；需要團隊漏斗夾具（template、partner page、上下線關係） |
| `disableTeamLiveShareAction`、`setPartnerPagePublishAction` | 無 |
| route：`checkout/upsell` | mock；租戶邊界完全來自 `resolveBuyerSupportGrant`，本 PR 已在 DB 層以買家客服三個 action 驗證；DB 層加購正向案例需要單品項訂單與加購商品夾具 |
| route：`team-funnel/*` 9 個、`interaction-scripts/upsert`、`live-danmaku`、`live-danmaku/scripted`、`live-interactions/cards`、`live-media`、`live-presenter`、`live-studio/drafts`、`media/images/complete`、`media/videos/{direct-upload,resumable-upload,resumable-upload/complete,status}`、`auth/line/start` | mock 或只有未登入案例 |

## 觀察（不是租戶漏洞）

- `upsertAffiliateAction`、`unblockBlacklistAction`、`upsertFormAction` 遇到別家或不存在的 ID 直接丟出 Prisma P2025（錯誤頁），沒有轉成乾淨的 not-found 回應。兩者結果相同，不洩漏存在與否（本 PR 有測試鎖住）；`unblockBlacklistAction` 也沒有寫稽核紀錄。
- `Affiliate.code`、`RegistrationForm.slug`、`Vendor.slug`、`Live.slug` 是全站唯一，用別家已存在的代碼新增會得到 P2002，可以探測代碼是否已被使用，但拿不到任何資料。
- `grantCommerceEntitlementAction`、`transitionServiceFulfillmentAction`、`completeShippingFulfillment`：同一商家內「A 訂單號＋同商家另一張訂單的權益／出貨 ID」會先提交狀態變更，事後才以訂單號不符回 `fulfillment_conflict`。只影響同一商家內的畫面一致性，不跨租戶。
- `reserveConsultationBooking` 從 `"use server"` 檔 export，會成為可呼叫的 Server Action；參數需要 database 物件，瀏覽器無法序列化，實際無法利用，但建議移到 lib。
- `affiliate-clicks` 接受任意 client `vendorId` 建立點擊紀錄（有每分鐘 60 次限制），推廣者與直播仍在該 vendor 內解析，不洩漏資料，但可灌別家的點擊表。
- 兩租戶夾具的清理一定因 `AffiliateCommissionLedgerEntry` 的 RESTRICT 失敗而提早結束（#464 審查 MINOR 已記錄），本批多建立的列同樣留在可拋棄的測試資料庫。
