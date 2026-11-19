# 兩租戶 action 矩陣盤點（R-05／F-134 第二批 2026-11-17；A2-06 第三批 2026-11-19）

盤點對象是 `master` 上每一個 `"use server"` 檔 export 的 Server Action，以及 `src/app/api/**/route.ts` 中接受 ID 的 handler。第二批以 `b552cd44` 盤點；第三批（A2-06）以 `8a7dc5e3` 重新核對路徑。每一列回答三件事：是否接受外部 ID、ID 是否在最後一次 DB 讀寫綁定目前 vendor（或夥伴／買家自己的授權），以及是否已有**真實 PostgreSQL** 的第二租戶回歸測試。

- 「db」：真實 PostgreSQL、用商家 A 身分帶商家 B 的 ID，斷言拒絕且兩邊資料不變。
- 「lib db」：同上，但測的是 action 呼叫的 `src/lib` 服務，不經過 action 本身。
- 「mock」：只有 mock prisma 的測試（例如斷言 `where` 帶 vendorId），不算 DB 層回歸。
- 「第二批」：#638 新增，見 `src/app/actions/two-tenant-actions-money-pii.db.test.ts`。
- 「第三批」：A2-06 新增，見 `src/app/actions/two-tenant-actions-content.db.test.ts` 與 `src/app/actions/two-tenant-actions-team-funnel.db.test.ts`，夾具在 `src/test/two-tenant-fixture-content.ts`。

## 結論

- **沒有發現租戶漏洞。** 每個以商家、夥伴或買家身分執行、接受外部 ID 的 action 與 route，最後的 DB 操作都綁定 session 的 vendor，或綁定夥伴／買家自己的授權。只用 id 查詢的地方都屬於兩種情況：平台管理員 action（`requireFinanceAdmin`，設計上跨租戶），或 id 來自同一交易內先以 vendorId 查到的結果。第三批的 35 個 action 也在真實 PostgreSQL 上逐一驗證，結論相同。
- Server Action：R-04（#653、#655）刪除 `src/app/actions.ts` 的 40 個純轉出口、並把品牌設定、`upsertAffiliateAction`、`retryWebhookEventAction` 搬到 `src/app/actions/*`。目前 61 個 `"use server"` 檔共 190 個 export，已沒有轉出口；`src/app/actions.ts` 只剩 `upsertLiveAction`、商家財務的 `recordAffiliatePayoutOutcomeAction`（#464 已有 db 回歸），以及結算、出款批次、退款等平台管理員 action。
- 以商家／夥伴／買家身分執行且接受外部 ID 的 action 共 123 個，**全部都有 db 或 lib db 回歸**：
  - 第二批前已有：56 個。
  - 第二批（#638）：30 個，涵蓋全部金流、佣金、退款與個資類（另加 3 個 route）。
  - 第三批（A2-06）：35 個，涵蓋原本只有靜態或 mock 檢查的內容、設定與團隊漏斗類；原本部分涵蓋的 `upsertLiveAction`、`landingPageAction` 也補齊（見下一節）。
- API route：116 個。46 個 job／ops／admin（secret 保護，無租戶 actor）、5 個 provider webhook（簽章）、34 個公開路由（含 3 個 viewer／講師雙模式）、31 個需要商家或買家身分。後者中 28 個接受外部 ID：第二批前 2 個有 lib db 回歸、第二批新增 3 個、其餘 23 個只有 mock 或無測試（見最後一節；不在 A2-06 範圍）。

## 第三批新增（A2-06，全部真實 PostgreSQL）

做法與第二批相同：外商家列在同一組兩租戶夾具上執行，斷言回應包含預期的拒絕、回應不含 B 的任何內容（投票標題、腳本／角色／影片／網站名稱、團隊分享碼），且兩個租戶的資料快照完全不變；對照的本商家列用 A 自己的 ID 走同一個 action，必須成功並寫入 A。另有「外商家與不存在的 ID 結果相同」的測試。

暫時拿掉 `endLiveInteractionAction`、`deleteInteractionRoleAction`、`updateEvergreenWebinarSettingsAction`、`saveVideo`（`upsertVideoAction` 的服務）與團隊漏斗商品欄位的 vendorId 條件時，對應外商家列與「不可區分」測試都會失敗；還原後全數通過。

表中「C」= `src/app/actions/two-tenant-actions-content.db.test.ts`，「T」= `src/app/actions/two-tenant-actions-team-funnel.db.test.ts`；測試列名稱以表中的 action 前綴開頭（例如 `live:`、`interaction role:`）。

| action | 檔案 | DB 測試 | 外商家 ID 的結果 |
| --- | --- | --- | --- |
| `upsertLiveAction` | `src/app/actions.ts` | C `live:`（B 的直播、影片、報名表、Email 範本、互動腳本、主視覺圖） | `?error=invalid_reference`；表單帶 B 的直播 ID 也一樣。A3-02 起資料庫已不接受 A 的草稿綁到 B 的直播（複合外鍵），測試改以 A 自己的草稿配 B 的直播 ID |
| `endLiveInteractionAction` | `src/app/actions/interaction-actions.ts` | C `live poll:` | 「投票不存在或已經結束。」 |
| `getLivePollStudioSnapshotAction` | 同上 | C `live poll:`（讀取） | 空陣列，不含 B 的投票 |
| `upsertInteractionRoleAction` | 同上 | C `interaction role:`（B 的角色、B 的頭像圖） | `missing_role`／`invalid_role` |
| `upsertInteractionRoleActionState` | 同上 | C `interaction role (state form):` | 「這個角色已不存在或不屬於目前商店。」／頭像資產無效 |
| `deleteInteractionRoleAction` | 同上 | C `interaction role:` | `missing_role` |
| `upsertInteractionScriptAction` | 同上 | C `interaction script:`（覆寫 B 的腳本、排程 B 的角色、聚焦 B 的商品） | `missing_script`／`invalid_reference` |
| `saveInteractionScript` | 同上 | C `interaction script (native form transport):` | `missing_script` |
| `unbindInteractionScriptFromLiveAction` | 同上 | C `interaction script:`（B 的直播、A 的直播配 B 的腳本） | 「直播不存在或未綁定此互動腳本。」 |
| `duplicateInteractionScriptAction` | 同上 | C `interaction script:` | `missing_script`（A3-02 起；與來源不存在相同），不建立副本 |
| `deleteInteractionScriptAction` | 同上 | C `interaction script:` | `missing_script` |
| `upsertVideoAction` | `src/app/actions/webinar-resource-actions.ts` | C `video:`（B 的影片、B 的縮圖資產） | `/videos?error=not_found`／`invalid_image_asset` |
| `archiveVideoAction`、`restoreVideoAction` | 同上 | C `video:` | `/videos?error=not_found` |
| `upsertFormAction` | 同上 | C `registration form (legacy editor):` | P2025，與不存在的 ID 相同 |
| `upsertTemplateAction` | 同上 | C `message template:`（帶 B 自己的版本戳記） | `missing_template` |
| `upsertFormBuilderAction` | `src/app/actions/form-actions.ts` | C `registration form (builder):`（B 的表單與版本戳記、B 的主視覺資產、B 的宣傳影片） | 版本衝突或已不存在／欄位錯誤 |
| `createAutomationRecipeAction`、`createAutomationRuleAction` | `src/app/actions/automation-actions.ts` | C `automation recipe:`、`automation rule:`（B 的商品） | `?error=invalid_product` |
| `dryRunAutomationRuleAction` | 同上 | C `automation rule:` | `?error=not_found` |
| `updateEvergreenWebinarSettingsAction` | `src/app/actions/evergreen-webinar-actions.ts` | C `evergreen:` | `/lives?error=live_not_found` |
| `updateConsultationEventAction`、`toggleConsultationEventAction` | `src/app/actions/consultation-actions.ts` | C `consultation:` | `/consultations?error=not_found` |
| `landingPageAction`（9 個操作） | `src/app/actions/landing-page-actions.ts` | C `funnel editor:`（check_publish、publish、unpublish、delete、duplicate、save、save_steps、rollback；create 綁 B 的報名表或直播） | 「找不到這個一頁式網站…」；unpublish 為版本衝突（與不存在相同）；create 為綁定無效 |
| `updateFunnelOperations` | `src/app/actions/funnel-operations-actions.ts` | C `funnel settings:` | 「找不到一頁式網站或沒有存取權限。」 |
| `saveBrandSettingsAction`、`saveBrandSettingsActionState` | `src/app/actions/brand-settings-actions.ts` | C `brand:`（B 的 Logo 資產；本商家列另帶偽造的 `vendorId` 欄位，被忽略） | `?error=invalid_logo`／Logo 資產無效 |
| `selectSalesProjectAction`、`publishSalesProjectAction` | `src/app/actions/sales-workspace-actions.ts` | C `workspace:` | `project_not_found` |
| `selectBillingPlanAction`（n.a.：方案是平台共用目錄） | `src/app/(app)/billing/plans/actions.ts` | C `billing plan selection` | 選免費方案只改 A 的訂閱與用量上限；B 的有效與待付款訂閱不變；偽造的 `vendorId` 欄位被忽略 |
| `manageTeamFunnelTemplateAction`（create、publish、create-share、disable-share） | `src/app/actions/team-funnel-template-actions.ts` | T `team template:`（B 的團隊、商品、webinar、模板、原始頁） | 「你沒有管理這個團隊模板的權限…」 |
| `claimTeamTemplateAction` | `src/app/actions/team-funnel-partner-actions.ts` | T `partner page: claim`（B 真正的分享碼） | 「此分享連結已過期、已停用，或不屬於你的團隊。」 |
| `savePartnerPageAction`、`setPartnerPagePublishAction` | 同上 | T `partner page:`（B 的夥伴頁、B 的團隊 ID、A 的頁配 B 的商品） | 「你沒有存取這個夥伴頁的權限…」；A 的頁配 B 的商品時 A 的文字也不寫入（A3-02） |
| `createTeamLiveShareAction`、`disableTeamLiveShareAction` | `src/app/actions/team-funnel-live-share-actions.ts` | T `Live share:`（B 的頁、B 的成員、B 的團隊） | 無權限、不能分享或分享不存在 |

## 第二批新增（#638，全部真實 PostgreSQL）

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

## 已有 DB 層回歸（第二批前）

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

## 仍未涵蓋（API route，留下一批）

Server Action 已全部有 DB 層回歸。下列 route 都已綁定 vendor（見上方結論），缺的只是 route 層的 DB 回歸；其中多數只是把請求轉給已在第三批以 action 驗證過的同一個服務（例如 `interaction-scripts/upsert` 走 `saveInteractionScript`、`team-funnel/*` 走同一組團隊漏斗服務）。

| route | 現況 |
| --- | --- |
| `checkout/upsell` | mock；租戶邊界完全來自 `resolveBuyerSupportGrant`，第二批已在 DB 層以買家客服三個 action 驗證；DB 層加購正向案例需要單品項訂單與加購商品夾具 |
| `team-funnel/*` 9 個、`interaction-scripts/upsert`、`live-danmaku`、`live-danmaku/scripted`、`live-interactions/cards`、`live-media`、`live-presenter`、`live-studio/drafts`、`media/images/complete`、`media/videos/{direct-upload,resumable-upload,resumable-upload/complete,status}`、`auth/line/start` | mock 或只有未登入案例 |

## 觀察（不是租戶漏洞）

- `upsertAffiliateAction`、`unblockBlacklistAction`、`upsertFormAction` 遇到別家或不存在的 ID 直接丟出 Prisma P2025（錯誤頁），沒有轉成乾淨的 not-found 回應。兩者結果相同，不洩漏存在與否（本 PR 有測試鎖住）；`unblockBlacklistAction` 也沒有寫稽核紀錄。
- `Affiliate.code`、`RegistrationForm.slug`、`Vendor.slug`、`Live.slug` 是全站唯一，用別家已存在的代碼新增會得到 P2002，可以探測代碼是否已被使用，但拿不到任何資料。
- `grantCommerceEntitlementAction`、`transitionServiceFulfillmentAction`、`completeShippingFulfillment`：同一商家內「A 訂單號＋同商家另一張訂單的權益／出貨 ID」會先提交狀態變更，事後才以訂單號不符回 `fulfillment_conflict`。只影響同一商家內的畫面一致性，不跨租戶。
- `reserveConsultationBooking` 從 `"use server"` 檔 export，會成為可呼叫的 Server Action；參數需要 database 物件，瀏覽器無法序列化，實際無法利用，但建議移到 lib。
- `affiliate-clicks` 接受任意 client `vendorId` 建立點擊紀錄（有每分鐘 60 次限制），推廣者與直播仍在該 vendor 內解析，不洩漏資料，但可灌別家的點擊表。
- 兩租戶夾具的清理一定因 `AffiliateCommissionLedgerEntry` 的 RESTRICT 失敗而提早結束（#464 審查 MINOR 已記錄），第二、三批多建立的列同樣留在可拋棄的測試資料庫。第三批另建立的 `BillingPlan` 是平台共用列，同樣留在測試資料庫。
- 第三批（A2-06）觀察，都不是跨租戶問題：
  - ~~`savePartnerPageAction` 先寫入夥伴頁文字，再由商品欄位服務檢查商品；A 的頁帶 B 的商品時，B 的商品不會被存入，但 A 自己頁面的文字已更新而回應是錯誤。~~ A3-02 已修：先驗證文字與每個商品欄位（`prepareTeamFunnelPartnerProductSlotOverride`），再在同一個交易寫入文字與所有欄位；任何一項被拒絕時什麼都不寫。T 的對應測試改成斷言 A 的快照完全不變。
  - ~~`duplicateInteractionScriptAction` 遇到不存在或別家的來源時，和成功一樣直接回到腳本列表，沒有錯誤提示。~~ A3-02 已修：不存在、別家或格式不對的來源一律 `?error=missing_script`（與刪除相同，列表頁顯示「已不存在或不屬於目前商店」），兩者回應相同、不洩漏存在與否。
  - `landingPageAction` 的 unpublish 是單一條件更新，別家、不存在或版本過舊都回「已有較新的版本」，與其他操作的「找不到」訊息不同，但別家與不存在結果相同。
  - ~~`LiveStudioDraft.liveId` 的外鍵只參照 `Live.id`，沒有綁 vendor。~~ A3-02 已改成 `(vendorId, liveId) → Live(vendorId, id)` 複合外鍵（migration `20261119150000`／`20261119150100`，見 `PRISMA_INVARIANTS.md`）；測試 `src/lib/live-studio-draft-live-vendor-fk-migration.db.test.ts`。
