2026-10-07 通知 CI correction：16b5d5c5 CI37591948632 FAIL，管理頁 mock 未包含新增 product 查詢；保留失敗收據。新管理頁檢查兩種 cursor 都在任何 DB query 之前，保留6既有page tests並新增2個first-purchase／purchase-cursor回歸。40 unit／5實際檔案、TS/lint、90mig／5/5actual browser零skip/flaky/cleanup PASS，source0b4585d9；73DB全部後端source hashes再次比對current相同，不冒用舊UI/browser證據。新checkpoint待push精確head CI；整個通知task NOT_READY，provider、其餘適用資源、full review及gate仍未完成。

2026-10-07 最新交付：F3 team/video #382 expected-head squash `4a4a0461aace0cde651b9a4021e415ef0da5e22a`；accepted head1dd0409c／treebee631dc3f620ea74e02804db2090571bd3bf2ff與合併tree完全一致，PR CI37589645770與push37589618194 SUCCESS、review4/4 []、canonical READY。實際URL影片CRUD/reload／租戶讀寫防護和team owner邊界已交付；Cloudflare upload仍未證明。Q2使用者明確核准原task第五次readonly review，5/5 []；接入新主線4a4後完整89source/test檔案hash不變，87 migrations/67DB/2browser零skip/flaky/cleanup PASS。新checkpoint3d32b0a0已push #379，CI37593169648／37593163815 RUNNING。兩個完整canonical snapshot各58檔（保留64cap，覆蓋全部89既有scope+共同runner/config依賴），gate只有current_full_quality_ci未驗證；非Production合成，未執行真實provider操作。通知16b5d5c5：90mig/73DB/32unit/5browserPASS、最新CI37591948632 RUNNING；尚待provider/fullreview/gate，不READY。

2026-10-07 最新 F1 通知增量：同一 f1-learner-notifications task/root writer，數位商品有效 grant 可發現／讀取／驗證／啟用購買通知；通用付款來源去重，退款後拒絕 opt-in／claim dispatch但仍可取消。最新90 migrations、73 DB（保留原70並新增3）、32 unit/4實際檔案、TS/lint PASS；失敗收據保留。新增第五個 actual digital UI/refund/reload journey；完整 browser session19374 RUNNING，來源固定。尚未完整 provider proof、full review／gate／CI／PR，不宣稱整批 READY。證據 remaining-capabilities-f1-digital-notifications-*.json。


最新 checkpoint 2026-10-07：F3 team/video PR #382 head `1dd0409c0bac4484465dc094a8ed0c866d91e767`，85 migrations、2/2 actual browser、zero skip/flaky、cleanup/source unchanged PASS；TS/lint/strict-index、2 source-binding unit PASS；独立 Critical review dispatch 4/4 []；canonical READY `sha256:35a0439b134b363d1dfe9ce9791d9300cf0a223d03cab79165be8fee6a14d367`。CI `37589645770` 執行中，未交付；Cloudflare upload 未驗證。證據在 editor worktree docs/remaining-capabilities-f3-team-video-*.json。F2 post-purchase latest head `e110d25ea46cf7667be94f336a90c1bd7d08e3e1` CI `37585393122` SUCCESS，但 external PayUni issued-checkout recovery 尚未完成，維持 NOT_READY。

2026-10-07 最新：F2 post-purchase 接入已交付 F3.2 主線c95f5869後，main-integrated候選f4e929cccdfb53d6321eaf379a7194125c3bde21 重新通過86 migrations/48 DB/177 unit/1 actual browser、零skip/flaky、cleanup PASS，source b1bf81ec75811a1493d185e19f14298d7109bf2774f9fcef40d94b19e08c5ea7；證據checkpoint e110d25e 已push，最新CI待核對，不沿用88f950 CI。Issued PayUni retry contract依然未完成、review2/4、NOT_READY。F3尚未交付的team/video入口驗收開始：重用remaining-editor-delivery乾淨worktree，新分支codex/team-video-delivery-20261007、新scope task remaining-team-video-delivery（不是重啟已交付editor-advanced-interactions，dispatch0/4）；新增actual video create/edit/reload/foreign read+forged write測試，保留既有wp86 team ownership完整斷言；new runner/config scoped lint PASS，browser session75268 RUNNING，結果未定。Canonical route基於agy catalogue驗證，Critical review plan Opus5.5 high/model-default、observed unknown；尚無review執行、gate或PR。所有其他Goal scope保留。

2026-10-07 F3.2 DELIVERED：PR372 已 protected expected-head squash merge c95f5869a09e863fef92cd57f853bc2504144809；接受head f24993f8d68a018f0273a0930cc5b573f526d109、exact CI37550502233 SUCCESS、canonical assess_acceptance READY、使用者授權final readonly review5/5無findings（native Sol high fallback、observed unknown）。17 changed source files hashes matched current validation，31 unit/16 harness/85 migrations/7 PG/1 course browser/1 actual Workspace Save-reload-tenant browser PASS；accepted tree與merged tree均31bbd6426f8813bd1231adf9262fcc7768e76060，無差異。新E1證據在editor worktree/docs/remaining-capabilities-f3-protected-delivery-20261007.json；F3 team/video與其他全Goal scope尚未完成。

2026-10-07 最新：使用者明確回覆「同意多一次審查」，僅授權 F3.2 原 task editor-advanced-interactions 額外 1 次，dispatch5/5、root 唯一 writer、1 readonly helper、depth1；精確 PR372 f24993f8d68a018f0273a0930cc5b573f526d109 final review 已派發 native Sol high canonical fallback，observed unknown，尚未 READY/merge。F2 post-purchase checkpoint88f950167d28508cd49c29580269f187fd4a4f1d 已推送：精確 payment result grant 恢復入口、清除合成 browser sessionStorage 後原交易恢復；86 migrations/48 DB/177 unit/1 browser、零 skip/flaky、cleanup/source binding PASS（3c531af5）。CI37582353322 契約清單漏 GET /checkout/upsell 已重現並補登，原 assertion 不變且單一 registry regression PASS；最新 exact-head CI37583883265 IN_PROGRESS。外部已發出 PayUni failed/expired 恢復契約尚未完成，review2/4，NOT_READY、無PR、未交付。

# 剩餘功能交付矩陣

2026-10-07 F2.3 checkpoint37626c2305016213f6c07c79c6b695a9ded17020：actual manager/partner/foreign登入→fee設定→payee提交→核准→quote→簽署→Save/reload→private CSV下載/冪等重下載→refund net新quote→撤權 browser1/1 PASS，0 unexpected/skip/flaky；90 migrations/24 PG/cleanup、65 unit/8files、TS/lint PASS。source revision c5eb518a66319648b9ec22e163aa66d1682fd42d37f14d171bf60c4d22c31f3b，1560 hashes於run前後及commit後逐一一致；證據F2隔離worktree/docs/remaining-capabilities-f2-remuneration-ui-browser-20261007.json。尚缺既有paid outcome current exported-snapshot/net契約、full financial regression、獨立Critical review/gate/精確headCI/PR/受保護交付；dispatch0/4，不宣稱READY/完成。

2026-10-07 F2.3 current UI candidate（base446ac87f，尚未checkpoint）：夥伴收款/報價/明示同意簽署、manager分類核准/私有CSV POST、現有入口links與bounded/private read model已實作。65 unit（8 files）、90 migrations/24 PG/0skip/cleanup、TS/lint PASS。固定loopback31040/disposable browser session65396已實際啟動，source凍結；新runner記full source hashes、immutable sanitized UUID receipt，不讀.env。付款outcome仍需綁current exported snapshot，不能用匯出當付款或宣稱整批READY；review0/4，完整same-task繼續。

2026-10-07 F3.2 PR372 head f24993f8d68a018f0273a0930cc5b573f526d109 精確CI37550502233 SUCCESS；仍review4/4、額外一次readonly核准未收到，未READY/未merge。F2.3 checkpoint446ac87fd8de7f5d2d50d1e9047de071c9b92ee1：merchant persisted fee政策/CAS/active manager、policy revision quote/sign/export綁定、受CSRF與affiliate_program/tax_remuneration保護的設定page/action與聯盟入口。90 migrations/22 PG/0skip/cleanup、52 unit/6files、TS/lint PASS；browser未執行，affiliate收款/quote/sign與manager核准/匯出UI、付款outcome契約、Critical review/gate/CI/交付未完成，dispatch0/4。證據F2隔離worktree/docs/remaining-capabilities-f2-payout-policy-ui-20261007.json。

2026-10-07 F2.3 checkpoint aa25c0f8a9462d75be10dc372f7d98aa1ba2f7dd：owner/admin current-state私有匯出服務、signed/exported重下載驗證、single immutable audit receipt、refund/export race及CSV formula/leading-zero保護。89 migrations/19 PG/0 skip/cleanup、45 unit/5 files、TS/lint PASS；首次export schema P1012失敗已保留並修正複合唯一鍵。尚缺persisted merchant fee policy/CAS、auth/CSRF/no-store API、affiliate/manager UI、payout outcome快照契約、實際browser及Critical review/gate/CI交付；root writer、dispatch0/4，同一完整task繼續。證據F2隔離worktree/docs/remaining-capabilities-f2-private-export-20261007.json。

2026-10-07 F2.3 checkpoint 8e91a7b5bf82fc453257c73064a54e7e02556aa9：ledger-bound報價/簽署服務已實作，current member/profile revision、淨佣金gross/扣繳/server fee、idempotent quote/sign、退款舊快照stale、DB immutable payload/signature/history及受限transition。88 migrations/15 PG（零skip、cleanup PASS）、TS/lint PASS；dispatch0/4，未接export/退款簽署匯出並發/API/CSRF/UI/browser/獨立Critical review/gate/精確CI交付，完整scope保留同一task。證據F2隔離worktree/docs/remaining-capabilities-f2-remuneration-quote-sign-20261007.json。F3.2 f249精確CI37550502233仍Release browser gates running。

2026-10-07 F2.3 checkpoint ba32681ef6c436a0170c34774b6afd5aae73fb36：收款資料service實作有效grant/member/user/affiliate檢查、owner/admin實際membership核准精確revision、CAS/serializable、修改撤核准及invalidate pending signed quotes；稅籍獨立AES-GCM purpose商家/affiliate/key綁定與bounded envelope。39 unit、87 migrations/9 PG/0 skip/cleanup、TS/lint PASS；dispatch0/4。未接routes/UI/quote/sign/export/refund並發、Critical review/gate/CI/交付，不宣稱可用。證據F2隔離worktree/docs/remaining-capabilities-f2-payee-service-20261007.json。

2026-10-07 F2.3 profile/snapshot資料契約：向前migration 20261007050000，87 migrations與6 PG回歸PASS/0 skip/cleanup PASS，涵蓋複合FK、核准revision、分類、金額平衡、簽署狀態、併發quote唯一及private RLS。首輪1 PASS/5 FAIL因Prisma client未更新，失敗收據保留，runner已補verified URL/no dotenv client generation後重跑6 PASS。schema validate/lint PASS，TS仍執行；consumer/稅籍加密/UI/退款併發/獨立review/gate/交付未完成。通知73de精確CI37548780837 SUCCESS（未宣稱整批READY）。

2026-10-07 F2.3 checkpoint 23684a857dc96e40d414a80a5a153ab4ef1269cb：affiliate收款帳戶沿用既有keyring/AES-GCM，加上商家、affiliate與用途認證綁定；新增13 unit驗證跨租戶/跨affiliate/商家密文替換、篡改、輪替及嚴格欄位，連同既有銀行5與扣繳17共35 PASS，TS/lint PASS。root writer、dispatch0/4；尚未接profile/schema/稅籍加密/簽署與退款併發/UI/export，Critical review與gate未完成，不宣稱可用或已交付。證據F2隔離worktree/docs/remaining-capabilities-f2-bank-binding-20261007.json。

2026-10-07 F3.2 最新 checkpoint f24993f8d68a018f0273a0930cc5b573f526d109 已推送 PR372：SSR hydration 修正31 unit、TS/lint、85 migrations/7 PG/1課程browser、1實際Workspace Save/reload隔離browser、16 harness全數PASS。舊025a CI37546949376 FAILURE保留；新精確head PR CI37550502233 queued、push CI37550499236 running。最新修正source hashes已比對一致；證據F3隔離worktree/docs/remaining-capabilities-f3-hydration-regression-20261007.json。review 4/4，額外一次readonly複審核准未收到，acceptance NOT_READY、未合併交付。通知73de最新CI37548780837仍running，不能沿用前一f6 CI成功宣稱最新head交付。

2026-10-07 F2.3 扣繳／提領：新隔離 worktree C:/Users/eden/.codex/worktrees/remaining-affiliate-withholding/CelebrateDeal，branch codex/affiliate-withholding-payout-20261007，F2.2 dependency f3e65b97940448e0b2d0803c751591ff8d49f01c 接入 master f739；root唯一writer，dispatch0/4。參照 retained b795 的扣繳／勞報／快照用途，實作版本化整數佣金扣繳／NHI／fee／net core，17 unit、TS／lint PASS；checkpoint acbee948e33cc93a5b79032f0fc4450b1eb58add。本批尚未建立 profile／schema／consumer／UI／export，不宣稱功能可用或READY，完整同一F2.3範圍繼續；沒有恢復旧migration。F2.2獨立複審4/4仍待核准，不能由新task取代。證據該worktree/docs/remaining-capabilities-f2-remuneration-foundation-20261007.json。

2026-10-07 最新 UI 增量：學員 dashboard（課程／預約／優惠券／訂單）、通知管理、通知設定及提醒已接繁中／英文，原始商家／學員文字與 session、權益、CSRF／CAS 不變。實際48 unit（10個存在的測試檔）、TS／lint PASS；90 migrations、4／4 actual Chromium、零 flaky／skip／unexpected、cleanup PASS，revision sha256:82e416e95be9220fef0f3127d232440df38953d9b5fa56aee4eab8f2a52f5b1d，新 source hashes 逐一一致。前一24-test指令包含 settings12／player10／community2，重跑 settings12 並未增加unique測試，且登入form測試當時不存在；新回歸已補上且舊證據錯誤label已更正，歷史Git與checksum保持原狀。整批 NOT_READY；non-course／provider／完整review／gate／CI／交付仍待完成。證據 remaining-capabilities-f1-retained-ui-locale-20261007.json。

2026-10-07 最新續接：F3.2 在 managed worktree remaining-editor-delivery 接入 master f739c7e017d430f05cc10a85728f5335e1bc20be，候選61a37fb9e110dbb27dff681204970f96cafd8510：15 unit、16 Chromium harness、1實際 workspace Save/reload/跨租戶 browser PASS，零 flaky/skip，disposable cleanup PASS。新 source hash 收據已保存於 docs/remaining-capabilities-f3-mainline-validation-20261007.json；文件證據 commit025a863235512396e9be4d13317968479bf3286d 已推送 PR372，精確 head CI37546949376 IN_PROGRESS。新增 review 授權仍 PENDING（4/4），尚未 READY/交付。通知前一 browser41732 terminal FAIL（3 expected、1 flaky），收據保留；新測試等待中文播放器及原有完課狀態確認語言切換完成，保持全部原斷言。新 browser session28934已實際啟動，結果未定；此處不宣稱修復通過。Goal 全範圍保持 IN_PROGRESS。
2026-10-07 locale 增量：登入頁、播放器、討論 feed／精確 thread 已接 locale；保留 SSR hydration、既有 CSRF／paid-course progress、initialThread、商家／學員原文與 React escaping。30 targeted unit、TS、scoped lint、diff check PASS。前一 browser 在語言 selector 有歧義，已改 named combobox，失敗收據保留；新的完整 browser98929 執行中，未使用前一 PWA PASS 證據支持新 locale source。證據：`remaining-capabilities-f1-notifications-locale-checkpoint-20261007.json`。Full notification review／provider／non-course／全 UI locale／acceptance／交付仍未完成。

2026-10-07 最新增量：PWA 候選 `e441334c478a33439422c7973055b8d662621478` 實際 disposable browser PASS：90 migrations、4/4 Chromium、0 unexpected/skip/flaky、cleanup PASS，1487 source hashes 與候選逐一一致。PWA 起始頁已固定在 `/portal/start/welcome`，保留 `/portal/` worker scope；actual provider delivery=false。精確 head CI37542190238 仍在執行。後續登入頁／播放器 locale 增量保留原有 hydration、CSRF、progress 契約，16 targeted unit、TS、lint PASS；新 English 同筆課程 mark/reload browser6736 仍執行，不能沿用上一版 browser 證據。整批通知及其餘 Goal scope 未 READY／未交付。

目前狀態以本段及後續最新 checkpoint 為準；下方接手基準與歷史收據保留。2026-10-07 核對：F1.1 PR370 已交付；F3.2 PR372、Community PR373、F2.2 與 Q2 PR379 尚待最新候選額外 review 核准，不能宣稱交付。Q1 PR371 尚缺核准的精確 sandbox 注入。F1 通知的六個課程來源已接入，目前新增 PWA push 接收與離線隔離驗證，整批 NOT_READY。精確 head `3287fbd1ce4a189ac2bc3d9fae8aa64045388bb5` CI37538579027：4721 Vitest PASS，Node TAP 1066 PASS／1 migration inventory 測試失敗；固定歷史 runner 不變，新增 migration 清單已校正，12 targeted TAP PASS。新 PWA 候選需獨立的新 browser／CI 證據。

目前核對主線：`728f0e591c0a5d4a83fe98d6a98146f9d7d0d842`（F3.1 #369 與 F1.1 #370 已交付）；F1 #370 head `84cdb475` 雙 CI SUCCESS、合併 tree 一致；Q1 #371 Draft head `561ffdfe` CI 未通過。以下最初接手 SHA 為歷史紀錄。

接手基準：`origin/master` `1cb2a32ea08e429de4e148ce24abc3d157b34f0c`，PR #368 已合併，接手時 open PR 為空。以上更新優先於歷史 publication／delivery-state snapshot；來源分支與原始 dirty 工作保持原狀。

Goal：`remaining-capabilities-20261005`，狀態 **IN_PROGRESS**。承接既有 `CELEBRATEDEAL-M2-M7` 的功能待辦，不覆寫其來源狀態。只有下列全部必要交付與驗收通過才能完成。

| ID | 精確來源索引／缺口 | 相依 | Owner | 驗收條件 | 新證據 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | future-work F1；#210/#211：播放器、進度、證書、社群、多語/PWA/push、SMS/WhatsApp | 現行 portal session、租戶與購買權益 | 主代理，待分批路由 | 每個能力具完整 UI/API、跨租戶/權益回歸、DB 與瀏覽器旅程；provider 實測分開標記 | F1.1 本機 unit、7 PostgreSQL、1 Chromium、Critical review及canonical READY；其餘 F1 待續 | IN_PROGRESS |
| F1.1 | #210/#211；`b7956d803f8dfebbbfdb3a4faeff497ab4bc140e` 的原生播放器/progress/certificate，依現行契約重建商家單元發布 | manager auth/CSRF、portal session、paid entitlement、前向 migration | 主代理唯一 writer；獨立 Critical reviewer（policy fallback Astra high） | 商家發布→學員權益學習→75秒持久化/reload續播→完課證書→退款撤權；跨租戶/跨課程/併發/CSRF回歸 | 本機 unit/typecheck/lint、84 migration、7 DB、1 Chromium PASS，canonical acceptance READY；`remaining-capabilities-f1.1-local-receipt-20261006.json`；精確 head push/PR CI SUCCESS；#370 squash `728f0e59`、tree 一致 | DELIVERED |
| F2 | future-work F2：affiliate、階梯/多層佣金、扣繳/payout export、referral、upsell、tracking/webhooks、私訊/廣播 | 現行收入快照、退款、權限/provider 契約 | root 唯一 writer | 先跨租戶/併發/退款回歸再接 UI；Critical review、精確 head CI | F2.1 已實作並正在驗證；其餘完整範圍保留 | IN_PROGRESS |
| F3.1 | #211 `b5397dbb45ddc4dc15a3059b7dec90b5a7771487`：editor parent echo、文件替換與 undo/redo lifecycle | 現行 FunnelPageEditor / FunnelStepPagesEditor | 主代理 writer；f3_inspect 唯讀 | parent echo 保留歷史；外部替換顯示新文件；undo/redo 不還原外部舊文件；真實瀏覽器測試 | `remaining-capabilities-f3.1-local-receipt-20261006.json`：14 unit、9 Chromium、lint/typecheck、獨立複審與 canonical READY；push/PR CI PASS，#369 squash `2319c742`，合併 tree 與驗收 head 一致 | DELIVERED |
| F3.2 | 流程編輯器已接入實际workspace；三項review finding修正完成完整回歸；team/video尚未承接。同來源：popup/template/flow 完整互動、team/video UI 與 guard inventory | F3.1、逐功能核對實際介面 | 主代理，待分批路由 | 完整瀏覽器互動與持久化；必要 disposable QA；舊 selector 只對應已交付 UI | `remaining-capabilities-f3.2-local-receipt-20261006.json`：13 unit、16 harness、actual workspace browser、獨立複審及 canonical READY；#372 CI/整合待驗證 | LOCAL_ACCEPTED_REMOTE_CI_PENDING |
| Q1 | #371 Draft；精確 consumer/proof 已實作，本機76 unit與8DB通過；CI未通過，sandbox指定交易驗收缺注入。`35d8f59341bcb776e548c69fe874a3f4d1fe2528`：固定 PENDING_REFUND consumer | 精確交易 ID、非 Production 綁定、現行退款契約 | 主代理，待分批路由 | 權限/CSRF、單筆 processed RefundRecord、冪等/重複拒絕；sandbox 與 mock 分列 | 待產生 | PENDING |
| Q2 | `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`：owner/buyer/subscription recovery 與 ops | 固定非 Production 資源/環境契約 | 主代理，待分批路由 | 隔離、越權/錯環境拒絕、recovery 回歸與必要 staging 實測 | 待產生 | PENDING |
| A1 | `937f796d25d0e27db753b7786ea77ea3e773a686`、`bf45235f8b10fa1fded2da0a4c079e5b883cfef0`：未遷移應用/workflow | F1/F2/Q1/Q2 | 主代理直接處理 | 每個有用能力接現行 canonical vNext；無第二套 launcher/舊排程 | 待產生 | PENDING |
| E1 | future-work E1：歷史證據及 tmp/support 差異 | 每批候選 snapshot | 主代理 | 新 revision 綁定的 validation/review/CI/acceptance；不降低測試範圍 | 各批收據 | IN_PROGRESS |

## 執行契約

- 現行 canonical policy：一個 writer、一個唯讀 helper；每 task 最多四次 dispatch，depth 1，不遞迴。
- 本輪明確 user dispatch，`automatic_spawn=false` 不改寫。模型路由保存在各批 route receipt；主代理模型不因路由而宣稱切換，observed 未回報時為 unknown。
- 已確認 `.github/workflows/ci.yml` 同時監聽 push/pull_request；保留現有 lint、typecheck、unit/coverage、router 與 browser gate。
- 檢查未執行不得標 PASS；同一 snapshot 經 canonical acceptance 與精確 head CI 才可交付。正式環境操作未授權。

## 2026-10-06 交付 checkpoint

F3.1：PR [#369](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/369)，候選 head `00d43f4875489a1fa6f0b30a5cb2397f35fa3743`，merge `2319c742f1455681ff08b720c193a2faf1545e27`。push run `37354840583` 與 PR run `37354873011` 全部 quality PASS；expected head 合併後 tree 比對無差異。

F1.1：native curriculum/player/progress/certificate 位於 `codex/remaining-course-learning-20261006`，已接續 master #369。完整 84 migration chain 及 7 PostgreSQL 邊界回歸通過；source snapshot/瀏覽器/Critical review 尚待最終候選 gate，不宣稱交付或外部影片 provider PASS。

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 latest candidate: 13 unit, 16 harness Chromium, actual workspace persistence/cross-tenant browser, lint/typecheck PASS; independent final review no findings; canonical READY. Exact-head CI and protected merge pending. Evidence: `remaining-capabilities-f3.2-local-receipt-20261006.json`.

F3.2 PR #372 CI補正最新source `sha256:f78ea317453e2479a29bd96add6ae20260599781edcb35ddabc95003201a0f10`：13unit、TS/strict-index/lint、16harness、84migrations實際workspace browser、2完整release browser皆PASS。獨立review4/4已用滿，額外1次同task複審await owner；canonical gate依medium-risk policy回傳READY；使用者要求的最新修正獨立複審仍待授權，不將oldrevision審查改成新revision PASS。新checkpoint見 `remaining-capabilities-f3.2-ci-correction-checkpoint-20261006.json`，尚未交付。
F2.1 `codex/remaining-affiliate-portal-20261006`：明確 tenant/member 授權、版本 CAS、停用後可撤權、帳本淨額／退款、佣金與授權分頁、商家公開ref連結、超過200名成員搜尋已實作。6項 disposable PostgreSQL 回歸PASS，第三輪獨立 Critical review 無findings（dispatch3/4、observed unknown）；完整 browser 與最新精確source gate執行中，尚未READY／PR／交付。歷次 browser fixture失敗單獨保存，未降低金額或歸因assertion。

F2.1 latest source `sha256:4aec9256be9760e011a88cb6eb3dba17860a844db774e578ff0c292e5837e2b0`：9 targeted unit、TS/strict-index/lint、1067 Node TAP零skip、85migrations、6DB、1實際browser zero flaky全部PASS；第4/4獨立Critical複審精確25檔及hash一致無findings，canonical READY。精確head CI與protected PR待交付，其餘F2 scope未縮減。證據 `remaining-capabilities-f2.1-local-receipt-20261006.json`。

## 2026-10-07 接續狀態補記

歷史行與證據保留；以下是本次實際狀態。

| ID | 精確來源／相依 | owner 與缺口 | 驗收／新證據 | 狀態 |
|---|---|---|---|---|
| F1.1 | PR370，merge `728f0e591c0a5d4a83fe98d6a98146f9d7d0d842` | root；課程批次已交付 | 已驗收 tree 與 merge tree `8cbbcc07a75af21815d57ec9b276517293fe1486` 一致 | DELIVERED |
| F2.1 | PR374，merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73` | root；affiliate portal 已交付 | 已驗收／merge tree `4f63c92d6c24e6585484912863704b3ecffd1f43` 一致 | DELIVERED |
| F1 通知 | retained `e1f38be324e349969a657be376aa1602e804c2dd`；現行課程與權益 | root 唯一 writer；email/push/SMS/WhatsApp、六個 retained event 完整範圍保留。provider、push enrollment、event producer、UI/browser 尚未完成 | `remaining-capabilities-f1-notifications-outbox-20261007.json`：86 migrations、20 PG、14 unit、12 TAP、TS/lint PASS。內部驗證 token 為合成，未聲稱外部聯絡方式或送達成功 | IMPLEMENTED_BACKEND_PHASE_NOT_READY |
| Q2 | PR379；`f989dba69361b38d764b46cb1736203109315504` CI 的兩個 Playwright 檔案被 Vitest 誤載 | root；.browser.ts 配置修正正在獨立隔離 runner 驗證；新增 review 超過4/4，等待明確增額核准 | 前一配置87 migrations／67DB／2browser PASS；新配置尚待本次收據／精確 head CI | IN_PROGRESS |
| F1.2／F2.2／F3.2 | PR373／commission branch／PR372 | 最新候選 review 上限4/4已滿，額外1次仍待核准；不能以其他批次 review 取代 | 已存在測試不代替最新候選 review | REVIEW_AUTHORIZATION_PENDING |
| F1其餘／F2其餘／F3其餘／Q1／A1／E1 | 原 work matrix 與 future-work 精確來源 | 保留完整功能及相依；Q1精確sandbox注入仍阻塞外部旅程 | 本次補記沒有縮減或轉移範圍；整體 Goal 未完成 | IN_PROGRESS |

F1 通知補記：已接上 configured-only email／Web Push／Twilio SMS／WhatsApp template adapter，24 項 mocked unit 契約 PASS，連同既有 contract/API 共36項測試；最新21項實際PG回歸與86 migrations PASS，source fence一致。此批未執行外部送達，worker/event producer/UI/browser/approved provider驗證/獨立review/gate/CI仍未完成。精確證據 `remaining-capabilities-f1-notifications-providers-20261007.json`；不宣稱 F1 READY。

### F1 通知 worker checkpoint 2026-10-07

- ID：f1-learner-notifications；來源 e1f38be324e349969a657be376aa1602e804c2dd；owner root，dispatch 0/4。
- 已實作：既有 authenticated email job 接入限定租戶與已設定渠道的通知 worker；精確 claim、最終購買權益與同意鎖定；不明 provider 結果不重送。
- 驗證：86 migrations、26 PostgreSQL 回歸、19 job/route/registry unit、TypeScript、scoped lint PASS。Provider callback 僅合成測試，沒有實際外部寄送。
- 證據：docs/remaining-capabilities-f1-notifications-worker-20261007.json，revision sha256:46c5f7fbc1fcf7fc391fd6df50dc58e0f77ac1a9bf246fdeb45b052c06d9d6f0。
- 狀態：IMPLEMENTED_WORKER_PHASE_NOT_READY；仍缺 durable challenge delivery、全部六種 event producer、UI/browser、核准非 Production provider 驗證、Critical review、canonical acceptance、精確 head CI 與 PR 交付。整體 Goal 保持 IN_PROGRESS。

- F1 notifications proof API checkpoint：POST /notifications/verify 已接上 server session、CSRF、exact challenge/session/course、strict 4KiB body 與安全 response projection；8 API + 1 registry unit、26 PG/86 migrations、lint、TypeScript PASS。證據 remaining-capabilities-f1-notifications-proof-api-20261007.json。狀態 NOT_READY，驗證碼 durable delivery、六事件 producer、UI/browser、外部 provider、review/gate/CI/交付仍未完成。

### F1 durable contact proof checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch 0/4；exact source e1f38be324e349969a657be376aa1602e804c2dd。
- Enroll API 已接上購買權益、server session/CSRF、核准租戶/provider、HTTPS origin、CAS 與同收件人/渠道跨課程 60 秒 cooldown。驗證碼加密 durable queue，輪替/過期/退款拒絕 provider；單筆 provider attempt、不明結果或 commit failure 不自動重送；回應不包含 token/contact。沿用既有 job，沒有新排程。
- 87 migrations、32 DB、44 targeted unit、12 migration contract、scoped lint、TypeScript PASS；合成 callback，實際渠道/browser 尚未執行。
- 證據：docs/remaining-capabilities-f1-notifications-durable-proof-20261007.json；revision sha256:984c302d5b8b4baddb9efdd20c0a8239330b923c1558ef25ca5d304859875827。狀態 IMPLEMENTED_DURABLE_PROOF_DELIVERY_PHASE_NOT_READY。all six retained event producers；actual settings UI and browser journeys；approved nonproduction provider injection and validation；independent Critical review；canonical acceptance；exact-head CI/protected PR delivery 尚未完成。
- Q2 PR379 head 080692a970bcadb312825eda691be63f10d7e093：PR run 37511340335 與 push run 37511330840 SUCCESS；最新修正複審需第 5 次 readonly dispatch 授權，仍未合併/READY。

### F1 通知設定實際 UI checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch 0/4；原始來源 e1f38be324e349969a657be376aa1602e804c2dd。
- 課程頁已接入 Email/SMS/WhatsApp/push 登記與驗證、明確 opt-in/opt-out；只在使用者操作時申請 push 權限，沿用既有 PWA registration；無 service worker 時顯示原因。GET/enroll 共用 public capabilities，無背景輪詢或 browser 持久化 contact/token。
- 最新 46 targeted unit、lint、TypeScript PASS；87 migrations、1/1 Chromium actual session/API/DB withdrawal+reload+CSRF+foreign course refusal，0 skip/flaky、cleanup PASS。已驗證收件 fixture 僅合成資料，未證明真實渠道送達。
- CI37516281028 在 migration inventory 85/87 不一致失敗；已更新精確87與兩個新 migration presence checks，保留歷史81 adapter拒絕規則。新增同一 CI notification DB gate，現有 release gate 保留並自動執行新browser，沒有新 workflow/skip/exclude。新精確 head CI 待推送。
- 證據 docs/remaining-capabilities-f1-notifications-settings-ui-20261007.json；revision sha256:5db95ea9455a22c75b4bb791d81b64e0659b97e2a910ef1403bab6eb65db9a37；browser source sha256:0ad58e3929a060e5ed08604a6d10fa3f684c51208c95f45677f43a70c821207e。狀態 NOT_READY。未完成：six retained event producers and applicable product/recipient contracts；full enroll/verification browser journeys with approved nonproduction providers；PWA integration and native push browser proof；post-refund durable settings navigation；independent Critical review；canonical acceptance；exact-head CI/protected PR delivery。整體 Goal IN_PROGRESS。

### F1 退款後通知管理 checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch 0/4。學員中心新增通知管理入口；bounded cursor list21/visible20，限定 server vendor/customer；既有偏好可在退款/到期後讀取及撤回，不授予課程內容或新 opt-in，未登記者仍須目前權益。
- 27 targeted unit、32 DB、87 migrations、latest1/1 actual Chromium、0 skip/flaky、cleanup、lint、TypeScript PASS。Actual browser 用 canonical refund ledger 及既有合成驗證 fixture，證明退款後取消/重載與有效 CSRF re-enable404；不代表真實退款或實際渠道送達。
- 證據 docs/remaining-capabilities-f1-notifications-refunded-settings-20261007.json；revision sha256:3f59201892bdf5fa4f06156eb4637a249548061725802981dcf889fb58110346；browser source sha256:43c63ad4263144b8072f03cbfbd9283caa801c0189b91b2021f9fc54fb7c2252。NOT_READY；six retained event producers and applicable product/recipient contracts；full enroll/verification browser journeys with approved nonproduction providers；PWA integration and native push browser proof；independent Critical review；canonical acceptance；exact-head CI/protected PR delivery 仍須完成。

### F1 通知 domain source checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。實際發布與完課同交易寫入加密 source outbox；20 recipient cursor、revision CAS、目前權益及事件前 consent 檢查；其餘四類事件未完成。
- 88 migrations、38 DB、25 source/inventory unit、9 player unit、lint及 source kernel TS PASS。通知1/1 actual Chromium/0skip/0flaky PASS早於最新 hydration correction；latest完整課程 browser及TS RUNNING。
- CI37518666624/head383466dd 在 native-course-learning63/70 首次進度/續播失敗，retry flaky 擋 gate。保留 assertion及零 flaky門檻，修正 hydration同步待實測。
- 證據 docs/remaining-capabilities-f1-notifications-source-phase-20261007.json；NOT_READY。渠道完整流程、Critical review、canonical acceptance、exact CI與 protected delivery仍待完成。

### F1 課程付款通知 source checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。Exact canonical paid transaction內依order/vendor/product/buyer hash產生payment_success；legacy無buyer hash及已刪除product無學習資源不指定收件；course purchase範圍，未宣稱通用訂單渠道全部完成。
- 最新88 migrations/40 DB/43 targeted unit/lint PASS；新增source fault rollback與foreign/repeated paid回歸。40案例第一次全PASS但舊38數量gate exit1已保留，更新精確40及receipt一致性後整個runner exit0 PASS。TS待收齊。
- fd7394c5完整course7DB/1actualbrowser/0skip/0flaky PASS，早於payment source修改；CI37522734648仍RUNNING，不可支撐新candidate。
- 證據 docs/remaining-capabilities-f1-notifications-payment-source-20261007.json；NOT_READY；未完成項目保持Goal範圍。

### F1 課程綁定直播通知 source checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。實際 owner commitLiveDraft 同交易讀取已持久化live/course binding並發布來源；delivery持鎖檢查精確 session/目前綁定及購買權益。直播结束/重新session/移除binding不發舊通知。
- 88 migrations、45/45 DB、329 existing action unit、42 notification contract/provider/job unit、lint、TypeScript PASS。DB包含lifecycle source fault完整rollback、foreign/wrong session、single attempt、ended afterclaim、restart/unbind suppression。Callbacks均合成，不代表真實送達。
- 證據 docs/remaining-capabilities-f1-notifications-live-source-20261007.json。NOT_READY；latest actual owner browser、consultation/discussion及非course適用契約、渠道完整旅程、Critical review、canonical acceptance、exact CI/protected delivery仍未完成。

### F1 通知實際介面與 consultation 回歸 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。修正實際 consultation reservation 的 Prisma salesProject relation；公開預約尚未寫入個人提醒，必須先完成 verified recipient authorization。
- 88 migrations、48 PostgreSQL regressions、25 targeted unit、lint、TypeScript PASS。Latest actual Chromium 2/2、0 skip/flaky、cleanup PASS，涵蓋 learner refund settings 與 owner live start/Save/reload/end；source sha256:c0edc059f82eb208111b01f207442948be3ea48aa96c96560b606fbc48bce916。
- 完整 Vitest 628 files/4662 tests PASS；完整 coverage attempt exit1，尚未取得 merged coverage。Node TAP 診斷1056/1067 PASS、11 FAIL；已確認 mirror staged index 與診斷 TEMP 在 workspace 內的環境問題，隔離修正後重跑 RUNNING，不宣稱品質 gate 通過。
- 證據 docs/remaining-capabilities-f1-notifications-current-regressions-20261007.json；NOT_READY。Consultation/discussion、非course適用契約、渠道及 native push 完整旅程、Critical review、canonical acceptance、exact CI/protected delivery仍需完成。
- 上述隔離環境修正後，完整 Node TAP 1067/1067 PASS、fail0、skip0。合併 coverage 門檻重跑中；不以單獨 TAP PASS 代替 coverage acceptance。

### F1 通知到期排程 checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。新增availableAt，與occurredAt/consent cutoff分離；approved tenant job只展開已到期來源，bounded2及20-recipient cursor保持。Additive89th migration保留既有資料時間；不修改歷史migration。
- 89 migrations、51 PostgreSQL回歸、32 source/job unit、12 migration inventory contracts、TypeScript、lint PASS。兩次fixture失敗及修正保留UUID收據；51案例包含原48及future/no-early-expansion、immediate default、實際forward SQL backfill。最新browser session88775 RUNNING，未重用舊成功證據。
- 前候選9c389a29完整coverage PASS：4662 Vitest、1067 Node TAP、0skip、lib branches80.15%符合80%原門檻；不支持後續schedule修改。證據 docs/remaining-capabilities-f1-notifications-coverage-20261007.json、docs/remaining-capabilities-f1-notifications-schedule-20261007.json。
- NOT_READY；verified learner確認及consultation producer、discussion、非course適用契約、完整渠道/nativepush、Criticalreview、canonical acceptance、exactCI/protecteddelivery仍需完成。
- Schedule候選最新actual browser PASS：89 migrations、2/2 Chromium、0skip/0flaky、cleanupPASS；source sha256:91f93345ec45d9090eb9f157f062b0973dd4c5544c908529e76227aefbe79c4b；所有收據檔案hash與目前來源逐一一致。checkpoint c88b9295／CI37531345759待完成；NOT_READY及完整未完成範圍保持。

### F1 已驗證學員預約提醒 checkpoint 2026-10-07

- ID f1-learner-notifications；owner root；dispatch0/4。實際課程/學員通知介面新增本人預約確認；same-origin/CSRF/signed session、目前購買權益及verified opt-in、booking/start revision/公開project/product binding，同交易upsert唯一personal source。匿名Calendar不提供個人提醒權限。
- 原51 DB保留並新增12，89 migrations/63 DB PASS；71 targeted unit、TypeScript、lint PASS。Actual2/2 Chromium、0skip/0flaky、cleanupPASS，新增本人確認→reload、正確foreign booking revision/CSRF/caller tenant拒絕；source sha256:b1ee8ac7d1ca2a9d72ddd26cac6cab1b2362843439da73725e96a8a26cfaba4d，hash逐一與目前來源一致。Provider callbacks全為合成，未宣稱真實寄送。
- 發送前持鎖重查exact booking/customer/start/project/course；取消、改期、撤除binding、unpublish及無encrypted確認證據均0provider calls。多次/併發確認只一筆source。
- CI37531345759/c88b9295有2個typed migration inventory未更新88/89造成unit failure；已補89及canonical inventory文件，保留歷史81 adapter拒絕與全部assertions。
- 證據 docs/remaining-capabilities-f1-notifications-consultation-reminder-20261007.json；NOT_READY。Discussion實際community介面、非course適用契約、渠道/nativepush完整旅程、Critical review、canonical acceptance、exact CI/protected delivery仍須完成。Community source只核對必要reply契約，未整合或宣稱交付；原worktree的2個untracked receipts保留。

### F1 實際討論回覆通知整合 2026-10-07

- ID f1-learner-notifications；owner root；source community `efee6e262685402b8c6efd13b2fe91091b49c70c`；dispatch0/4。接入 actual learner/manager community UI、API、唯一歷史 community migration 原文，未重新建立等價 migration；原 community 工作與 review limit/待核准狀態不變。
- 回覆與作者限定 encrypted source 同 Serializable transaction，UUID 重送/併發只一筆 reply/source，self reply不通知、不複製討論文字；通知 exact thread route 登入/權益重驗並可 reload。送出前鎖定原作者/visible parent/reply、退款/consent權益。
- 90 migrations/70 DB PASS，保留原63並新增7 real service/DB回歸；118 unit/12files、TypeScript、lint PASS。第三條實際雙學員發文→回覆→exact thread/reload→hidden/refund拒絕 browser handle48629仍執行，舊 browser 不支持新source。
- 前head435dcfbc CI37536141538 FAIL因API registry遺漏完整POST reminders path，已補文件且registry測試PASS；無品質門檻/assertion變更。
- 證據 docs/remaining-capabilities-f1-notifications-discussion-20261007.json；NOT_READY、NOT_DELIVERED。新 browser、完整非course/channel/nativepush契約、Critical review、canonical acceptance、exactCI/protected交付及其他Goal範圍保持未完成。

- 本次整合 actual browser 最終 PASS：90 migrations、3/3 Chromium、0unexpected/skip/flaky、cleanupPASS；全部收據source檔案hash逐一與當前候選一致。Browser source sha256:f6e90cc860a2e8ef4ac3023cc572921a1de72c60350f663df8fd4a3da4bb0468；已推送checkpoint `0aed9ac98e2cba6faef25e25cefccdd85c7a6373`。獨立native Sol high backend五檔findings[]、dispatch2/4；AGY前置BLOCKED_SENSITIVE_INPUT/0externalattempt如實保留，不代表Claude不可用。非course/fullchannel與整批review/acceptance尚未完成，NOT_READY/NOT_DELIVERED。










### F2.3 付款結果修正與最新驗證（2026-10-07）
- ID / owner：f2-merchant-remuneration / root；依賴 F2.2，原依賴驗收未解除。
- 現行實作：財務付款交易內重驗有效 tenant finance membership；精確 exported snapshot、ledger/profile/policy 與 net confirmation；向前 migration 090000 同 payout composite FK；付款後 manager/member 實領 read model。
- 已通過：91 migrations、28 disposable PostgreSQL tests（source 5242c7dae047b5fcfc91f1f6ac762dbbec72345e2e95b9cba5d28a9eb583e705）；最新 action/page 342 tests；scoped lint。
- 歷史本輪 browser source 3181e15648c5a65601ad14e18c8427c73ad2158053e5c0c8dbd44fbd9142331b PASS 保留。之後已修改 payer recheck / exported reuse / paid UI，因此最新候選 browser runner session 2167 執行中，不能沿用先前 PASS 支持最新候選。
- 獨立 findings review dispatch 1/4：MAJOR payer authorization race、MINOR exported requote；實作者已修正。native Sol high findings receipt 不符合 Critical acceptance effort，合規 Critical review 仍待執行；observed model/effort unknown。
- 狀態：IMPLEMENTED_VALIDATION_IN_PROGRESS；NOT_READY、未 PR、未 CI、未交付。證據位於金融 worktree docs/remaining-capabilities-f2-payment-*.json；原始 dirty 工作不變。

### F2.3 canonical 驗收與 Draft PR（2026-10-07）
- ID f2-merchant-remuneration / root；精確 head 7f4b0af161deda40139b55af06f5011e30f7746c；Draft PR #380。
- canonical assess_acceptance READY，51檔 snapshot b8578f7859027ef84d183101bf20a6c0b2592951fb8b165341abcaf47da83955；409 unit、TypeScript、scoped lint、91 migration/29 PG/1 fractional-money actual browser PASS，零 skip/flaky；Critical final review findings=[]、observed unknown，dispatch4/4。
- PR CI 37557623980、push CI37557600545精確 head執行中；未宣稱 CI PASS。F2.2相依驗收仍未解除，未合併、未交付。整體 Goal仍IN_PROGRESS。
- 精確證據：financial worktree docs/remaining-capabilities-f2-remuneration-acceptance-20261007.json、remaining-capabilities-f2-exact-cents-audit-browser-20261007.json、remaining-capabilities-f2-critical-review-final-20261007.json。


### F2.3 精確 CI 修正 checkpoint（2026-10-07）
- owner root；task f2-merchant-remuneration；最新 head `09d4e2b1d7bdb92402535a3922299f303ed5c6d6`，Draft PR #380。舊 head 7f4b CI37557623980 FAILURE；7 個失敗已對應修正，未降低 assertion／coverage／2500-line architecture ceiling。
- 驗證：契約與頁面 10/10、architecture／server actions 338/338、91 migration／legacy payout PG 5/5；TS PASS、lint 零 errors／warnings、全部零 skip；disposable cleanup PASS。137 models／91 migrations 清冊補齊，historical payment adapter 81 invariant 保留。
- 新 head PR CI37558895177、push CI37558891445 IN_PROGRESS；latest-source 29 PG／browser runner session70721 IN_PROGRESS，執行期間來源凍結。舊 READY／review receipt 不冒充最新來源驗收。
- dispatch4/4，最新版本獨立複審尚未完成；F2.2相依驗收未解除。NOT_READY、NOT_DELIVERED；整體 F1/F2/F3/Q1/Q2/A1/E1 範圍仍 IN_PROGRESS。
- 證據：financial worktree `docs/remaining-capabilities-f2-ci-correction-progress-20261007.json`；原始 dirty checkout 未修改。


### Q1 CI 精確定位（2026-10-07）
- PR371 head561ffdfe 的 CI37365296110 completed FAILURE；實際 unit／coverage step 為 CANCELLED，後續 gate SKIPPED。唯一 failure annotation 是 `The operation was canceled`（.github:498）；未證實 test assertion failure，raw failed logs 已無可取內容。
- 證據 `docs/remaining-capabilities-q1-ci-diagnosis-20261007.json`；不把取消當 PASS，未合併、未交付。核准 sandbox secret／精確 current-source payment handoff／browser 阻塞仍保留。

- F2.3 latest-source runner70721 已 terminal PASS：91 migrations、29/29 PG、1/1 actual browser、0unexpected／skip／flaky，cleanup PASS、sourceUnchanged true；source sha256:5f8cbc2c96ce3bcaec5f55760f969d047efda666d27f9f6e74ef6f80849b25ac。新證據 financial worktree `docs/remaining-capabilities-f2-ci-correction-browser-20261007.json` 綁定 head09d4e2b1；review cap 額外1次申請待人類答覆，未 dispatch5。PR CI37558895177 仍IN_PROGRESS於完整 unit／coverage gate，未交付。


### F2.3 完整 CI 中的 Node TAP 清冊修正（2026-10-07）
- head09d4e2b1 的 CI37558895177 terminal FAILURE；632 Vitest files／4699 tests 全數 PASS，Node TAP1064PASS／3FAIL／0skip。三項根因均是候選 migration inventory 仍固定86；已更新91及完整新增tail，歷史79／21範圍與checksum驗證完全保留。
- LF mirror讀取唯讀Gitobjects/core.longpaths，本機完整Node TAP1067/1067PASS、0skip，immutableGitprobe79PASS；原始history/checksum不變。產品來源未改，latest-source91 migrations／29PG／1 browser證據保持有效。
- 最新已推送 head`b9aa3ac93a6469668bdc739fd6fd67d06ba98ccd`；PR CI37560533164、pushCI37560528657 IN_PROGRESS。dispatch4/4，額外1次唯讀複審申請仍未答覆；未合併、未交付。新證據 financial worktree docs/remaining-capabilities-f2-ci-correction-node-tap-20261007.json。

### F2 私訊與精確購買廣播實作開始（2026-10-07）
- task f2-live-private-chat-purchase-broadcast；owner root，dispatch0/4，readonly最多1/depth1；來源60132971的instructor/private chat與purchase broadcasts。新隔離worktree `C:/Users/eden/.codex/worktrees/remaining-live-private-chat/CelebrateDeal`，base最新主線f739c7e0、分支codex/live-private-chat-purchase-broadcast-20261007；現有pending PR worktree不混入。
- 已實作實際GET廣播API與domain：admission/tenant/live重驗、可見商品、server checkout sourceLiveId、paid/unrefunded/test-order隔離；空商品不擴大查全店、opaque display id、bounded private no-store。11unit／TS／lint PASS。
- 實際85 forward migrations PASS；首次5DB測試因新fixture的Prisma nested create/lastSeenAt契約錯誤FAIL，證據保留；修正fixture而未降低assertion，新runner85240執行中。
- 私訊、廣播UI、完整DB／browser、獨立review、acceptance與CI／PR交付均尚未完成，不縮小F2範圍。

- F2購買廣播 backend最新來源6/6 disposable PG PASS（85 migrations），涵蓋101st visible product；unit／API registry12/12、TS、scopedlint零errors/warnings PASS、全部零skip，cleanupPASS；source2cd69ca8217f43040c228ac44997364cf9ff7c868037b1a7d4a8020e2eb8ee99。原首次fixture失敗與5DB先前候選PASS永久保留，不沿用為新候選收據。
- 新checkpoint已推送 `8b06c29a80ceec5dbb901e0dbbaf3414ebcbcc44`；branch codex/live-private-chat-purchase-broadcast-20261007，push CI37561131474 IN_PROGRESS。尚未PR／review／canonical READY，私訊與實際UI/browser仍需完成，NOT_DELIVERED。證據新worktree docs/remaining-capabilities-f2-live-private-commerce-checkpoint-20261007.json、remaining-capabilities-f2-purchase-broadcast-db-20261007.json。
- 金融PR380 headb9aa3ac9／CI37560533164最新仍IN_PROGRESS於完整unit/coverage，尚無failure steps。額外review dispatch申請沒有收到人類核准，4/4上限保留。
- 2026-10-07 本場購買廣播已接入實際 LivePlayback，需入場及商品揭露；刷新/跨租戶/跨直播立即隱藏舊資格。root 本機 checkpoint 6dbe50fee24ecf65ea469196482c02b2f203952a，尚未推送，原8b06 CI37561131474仍IN_PROGRESS。7 files/84 unit、TypeScript、ESLint PASS；新增回歸先抓到刷新首個render沿用資格，再修正為scoped admission。證據 remaining-capabilities-f2-broadcast-ui-checkpoint-20261007.json。當前UI browser未跑、private chat未完成、review/acceptance pending，NOT_DELIVERED；舊6 PG只證明未變backend。
- 2026-10-07 F2 private chat canonical access/encrypted storage contracts：本機checkpoint76607c8c，root writer，dispatch0/4。重用入場+fss1+VERIFIED form binding+blacklist檢查，不洩漏email/phone/bearer；AES-GCM目的綁定tenant/live/submission/message/source，冪等ID再綁actor及UUID。10 files/116 unit、TS、ESLint PASS；未新增model/API/私訊UI，DB/browser/review/gate仍pending，NOT_DELIVERED。證據remaining-capabilities-f2-private-contracts-checkpoint-20261007.json。原head8b06 CI37561131474及financial37560533164均實際Release browser gates IN_PROGRESS；未重啟、未取消、未聲稱最新本機head CI通過。
- 2026-10-07 F2 private storage：本機e951810de4ea66a7df8047f60af0f9f4806c1d2b（尚未推送）；新增LivePrivateChatMessage／20261007110000_live_private_chat_messages，127models/86migrations。86forward migrations、12PG（private6+broadcast6）、121Vitest/12NodeTAP、TS/ESLint PASS，cleanup PASS，source154b3e9c...。固定79/21及歷史checksum均保留。API/UI/browser/review/gate尚未完成，NOT_DELIVERED；docs/remaining-capabilities-f2-private-storage-{db,checkpoint}-20261007.json。
- Financial PR380 CI37560533164 FAILURE：Release browser gate wp88-direct-url-guard-matrix.spec.ts:79 精確頁面數仍90，實際93；manager guard數51→54，新增頁面皆有guard。root已修正精確inventory，不放寬assertion；隔離runner session37263執行91migration/29PG及remuneration+WP88兩browser，仍RUNNING、不得當PASS。Financial source在runner terminal前凍結，不重新dispatch（4/4，extra1仍待明確核准）。
- 2026-10-07 Financial PR380：CI37560533164 Release browser guard inventory FAILURE已修正，local91migration/29PG/2browser PASS（零skip/flaky、source unchanged f8324937...）。已push030c88f9113f7d6533e8567edb8f64b48bf01225；exact PR CI37563378318及push37563373313 RUNNING。Critical最新product修正仍需核准extra review（dispatch4/4），DRAFT／NOT_READY／NOT_DELIVERED。新證據financial worktree docs/remaining-capabilities-f2-ci-browser-guard-{diagnosis,correction}-20261007.json。
- F2 private viewer service/API已實作（尚未checkpoint）：RepeatableRead scoped50+cursor、Serializable freshauth retry/idempotency、body encryption；GET先授權再mintCSRF、POST CSRF/可信IP/strictbody、private no-store。先13/16DB FAIL（加密scope混入displayName）；保留source-bound failure，修正後16/16PG PASS。後续API/安全helper/空白body細節變更後，current-source DB session25538 RUNNING；136unit/14files、TS/ESLint PASS，包含原publicroute回歸。講師API/UI/browser/review/gate尚未完成，不能宣稱整批交付。
- 2026-10-07 F2 private viewer API最新來源86migration/16PG PASS（零skip，cleanup PASS，source53047fc5...）；136unit/14files、TS/ESLint PASS。本機後續checkpoint已push385e646a0de080a23387276c9795ae57c04522a2，既有push CI待fresh核對。歷史13/16failed保留；公開chat安全helper抽出共用且原route回歸通過。尚缺講師API/current permissions、真正viewer/instructor UI、最新browser、獨立Critical review/canonical acceptance/PR；NOT_DELIVERED。新證據docs/remaining-capabilities-f2-private-viewer-{api-checkpoint,service-db}-20261007.json。舊8b06 CI37561131474 SUCCESS僅其exact head，不支持新385e整批驗收。
- 最新exact385e646a push CI37563649129已確認IN_PROGRESS；financial exact030c88f9 PR CI37563378318 IN_PROGRESS。未重新啟動或取消既有run。
- 2026-10-07 private instructor API已實作未checkpoint：server-derived actor/session，tx recheck active session、MFA、current canonical selected membership、owner/admin及project scope，50thread/message scopedcursor、encrypted idempotent reply。新DB source5e1374b4...完整86migration/23PG PASS、cleanup PASS、141unit/15files及ESLint PASS。含role/session撤銷、enrolled MFA、project aggregate readonly/current selected project、legacy null vendor session預設workspace不可任選membership。最新嚴格及普通TS session55346仍RUNNING；前一輪strict gate PASS但不能冒充最新版；browser/actualUI/review/gate pending，NOT_DELIVERED。
- 觀眾checkpoint385e646a CI37563649129 FAILURE在Strict production index access，local復現TS2345/2769：游標split欄位及page邊界缺明確空值檢查；已修正成guard及checked page.at(-1)，保留原strict-index config。診斷docs/remaining-capabilities-f2-private-ci-index-diagnosis-20261007.json。Financial exact030c88f9 PR37563378318/push37563373313仍IN_PROGRESS，無restart。
- 最新instructor API checkpoint已push41fb71d49a9d2cb3d3382e3aecbef0fa453bf75b：86migration/23PG、141unit、普通TS及CI同一production strict-index、ESLint PASS；source5e1374b4...，cleanup PASS。證據remaining-capabilities-f2-private-instructor-{api-checkpoint,current-db}-20261007.json。尚無actual private UI/browser及review/READY/PR，NOT_DELIVERED。
- 2026-10-07 F2 actual private UI本機checkpoint d62aee326533e287d0baa97c257a99789bb9788f（未push）：觀眾播放器已入場才能展開講師私訊，原public chat保留；共用private composer有abort/revision、不明送達沿用UUID retry、cursor較早頁；講師/lives/[id]/chat與活動列表導覽、thread選擇/分页、授權失效清除。146unit/16files、TS/strict-production-index、ESLint PASS；fresh86migration/23PG/cleanup PASS，source96a7714d...。protected page確數91/manager52已同步WP88，尚未跑最新UI browser／review／gate／PR，NOT_DELIVERED。證據remaining-capabilities-f2-private-ui-{checkpoint,bound-db}-20261007.json；dispatch0/4。既有CI仍屬41fb71d4，不能拿來當d62aee UI CI。

- 2026-10-07 Financial PR380：030c88f9 exact PR CI37563378318 FAILURE，native-course-learning retry=1 flaky。維持精確75秒斷言，改在既有bounded poll內觸發合成metadata，避免SSR media早於hydration；current db90c9582e5e6eb1c093535cd7174aefdd4323a2 已push。fresh91migration/29PG/3browser PASS，zero skip/flaky/source unchanged sha256:f942bdb0be9a4d5d12b57c50a5856789c9c712cbf9a55eeb119db13a7747fd4d，cleanup PASS；證據financial/docs/remaining-capabilities-f2-course-resume-ci-correction-20261007.json。PR CI37565997428、push37565993672確認IN_PROGRESS；dispatch4/4 extra approval仍未收到、Draft/NOT_READY。
- F2 private commerce：owned loopback ingress新增，會覆寫偽造forwarding/proof headers，synthetic probe PASS；不宣稱Cloudflare WAF驗證。guard browser runner session14988仍確認RUNNING，候選來源凍結。完整viewer/instructor收發、reload、第二觀眾隔離、CSRF/角色/驗證撤權旅程已在root owned tmp準備，待接入實跑，不能標PASS。

- F2 private live：新增私訊頁面的current-source WP88 browser PASS；86migrations/23PG/1browser/0skip/flaky/cleanup PASS，revision sha256:35029ec4cd17bb3c15ab722dc5ec45bcb09f5b20426b918209833fffdaa6b8b7；immutable evidence private worktree/docs/remaining-capabilities-f2-private-ui-guard-browser-20261007.json。完整private旅程已接入實際viewer UI/instructor login/reply/reload/第二觀眾隔離/加密落地/公開chat隔離/同UUID併發重送409改內容/CSRF及role與verification撤權。TS/ESLint PASS；新combined runner session11736確認RUNNING，兩browser候選來源凍結；未review/未READY/未PR/未交付，dispatch0/4。

- F2 purchase broadcast actual-browser regression已完成測試程式（root owned .ai-team/tmp/live-purchase-broadcast-journey.spec.ts），ESLint PASS；待現行private runner11736 terminal後接入，尚未實跑。覆蓋actual播放器商品reveal後的masked paid card、非本場交易排除、opaque order/payment IDs、canonical synthetic partial refund後reload清除；不呼叫外部payment/refund provider，不能作為Q1 sandbox proof。現行runner來源保持凍結。

- F2 private exchange browser已current-source PASS：86migration/23PG/2browser/0skip/flaky/cleanup PASS，revision sha256:c76db9bed723e0c8ba82da98e3342ecec9af26c3cfdf4d51ad564c4d29473893。證據private/docs/remaining-capabilities-f2-private-ui-exchange-browser-20261007.json；viewer/instructor real UI、actual login、reload、same-live other-viewer isolation、UUID concurrency/idempotency409、CSRF、role/verification revoke皆實跑。產品未再修改；加入broadcast browser後TS/ESLint PASS，combined候選仍未review/READY/PR/delivery。backend41fb71d4 CI37564507846已確認SUCCESS，不能代替含UI/runner新head CI。

- F2 combined runner73121 terminal FAILED：86migrations/23PG PASS、browser expected2/unexpected1/0skip/flaky、cleanup PASS；第三broadcast spec失敗，receipt revision sha256:9f0ada14c2a8f2b07c20fb438d540612a46f47d4a676cd88b0b5c42de9600f9c。已保存private/docs/remaining-capabilities-f2-private-broadcast-browser-failure-20261007.json，不冒充三browser成功。獨立review dispatch1 Opus實際TOOL_DENIED（不是MODEL_UNAVAILABLE），canonical fallback dispatch2 Astra high readonly正審查；source manifest bc9082cd...，observed均unknown。候選MAJOR viewer對話identity缺binding；broadcast spec缺origin亦已確認待修。root等待獨立final後整批修復，新candidate須fresh回歸/gate/headCI。

- F2 private Critical dispatch2/4 final CHANGES_REQUIRED，source manifest bc9082cd...核對1432檔無變更。2MAJOR（viewer/instructor opaque conversation/actor binding；broadcast trusted-IP limiter）及1MINOR（browser Origin）已由root修正，獨立review未改code；immutable report private/docs/remaining-capabilities-f2-private-critical-review-first-20261007.json。POST在fresh authorization transaction後驗binding才UUID查找；GET identity改變與403清draft/retry；instructor bind member/session。37 targeted unit、TS/ESLint PASS；新增2DB identity switch及actual-memory fake-header120→429回歸，browser補server commit後丟response再切換verified觀眾情境。最新25DB/3browser runner session73457確認RUNNING，source凍結、仍NOT_READY/NOT_DELIVERED、需fresh proof及獨立複審。

- F2 latest correction source snapshot sha256:1b8aebc087ed666e96f3bc01277b8c48bc4d7f1e04b95d60a40d80b7d2b1644e，canonical fallback readonly Astra high複審dispatch3/4已啟動（同task，非改名）；latest73457 phase25/25PG PASS，browser未terminal不得標PASS。Financial db90c958 exact PR CI37565997428 Unit gates已過、Release browser gates IN_PROGRESS。

- F2 corrections review dispatch3/4 final PASS []，source1b8aebc...1432檔核對unchanged；報告private/docs/remaining-capabilities-f2-private-critical-review-corrections-20261007.json。73457 terminal：25DB PASS、browser expected2/unexpected1、0skip/flaky、cleanup PASS；private identity-switch browser失敗，精確assertion未取得（舊runner只記spec起點），不得假設根因。保存private/docs/remaining-capabilities-f2-private-binding-browser-failure-20261007.json。僅改善closed diagnostics（error.location與白名單spec stack行號、不保存raw log），新diagnostic runner70377確認RUNNING；產品來源未再改，NOT_READY/NOT_DELIVERED。下一步先按精確失敗修test或code，再fresh驗證及最後一次獨立scope審查，不使用skip/timeout放寬。

- Financial PR380 exact db90c9582e5e6eb1c093535cd7174aefdd4323a2：PR CI37565997428及push CI37565993672已核對head/event/completed/SUCCESS。fresh local91migration/29PG/3browser/zero skip/flaky/cleanup PASS仍有效；CI補證financial/docs/remaining-capabilities-f2-remuneration-exact-ci-20261007.json。dispatch4/4，最新修正extra reviewer核准仍未收到，保持Draft/NOT_READY/NOT_MERGED。Private correction另fresh181unit/18files與strict-production-index PASS，diagnostic browser70377仍RUNNING。

- Private diagnostic70377 terminal FAILED，25PG PASS、browser2PASS/1FAIL/0skip/flaky/cleanup PASS，精確failure line97（uncertain-send alert assertion），revision ae9788ce...；immutable proof private/docs/remaining-capabilities-f2-private-binding-browser-diagnosis-20261007.json。Root把fault injection改為真實POST完成後在client fetch boundary丟response，新增actual201強斷言，私訊alert定位至獨有region；保留精確落地4筆、cookie switch A binding拒绝與draft清除，無假API回應。TS/ESLint PASS；新25PG/3browser runner48447確認RUNNING，source凍結；尚未最後scope複審（目前3/4）。Financial PR380 db90 exact雙CI SUCCESS仍Draft awaiting既有額外review核准。

- F2 private chat/purchase broadcasts：fresh 181 unit/18 files、whole ESLint、TS、strict-index PASS；86 migrations/25 DB/3 actual browser、zero skip/flaky、cleanup/source unchanged PASS。Final independent Critical review dispatch4/4 findings[]，manifest ac9e97c...1432 files unchanged；canonical assess_acceptance READY at e9d11aa...59-file snapshot。Accepted source vs staged Git blobs PASS（only LF normalization），head716c8253467a2b7b69c7bbc92d650ded6e18a4ae/tree d45335ce6f31635889a59955482231e65186a529 pushed；PR381 OPEN, exact-head CI pending, NOT_DELIVERED. Immutable review/browser/gate receipts in private worktree docs. AGY Claude transport PR377 merged5a25018; Sonnet/Opus actual 40,093-character SUCCESS retained; file-tool TOOL_DENIED uses canonical fallback and is not model-unavailable.
- 2026-10-07 F2 post-purchase 現行實作：隔離 worktree remaining-post-purchase-commerce、codex/post-purchase-commerce-20261007，base f739c7e017d430f05cc10a85728f5335e1bc20be。root 唯一 writer；task f2-post-purchase-commerce dispatch 0/4。已接入 merchant 既有 CAS/CSRF product form、buyer grant upsell/downsell、signed admission、single-use credit、原 pending checkout recovery 與退款撤權。131 unit/7 files PASS、最近 PG 86 migrations/26 tests PASS（zero skip，cleanup PASS，source65d97ee4）；後續加入 actual browser/config 與 recovery guard，需以最新候選重跑，不能沿用舊證據。現在 disposable browser session41109 LIVE；TS 發現新 browser fixture ShippingFulfillment 使用錯誤 orderId，待此固定候選 runner terminal 後修正並重跑。尚未獨立 review/gate/checkpoint/PR/交付，NOT_READY。PR381 exact716c8253 PR CI37569742620/push37569720886 都 FAILURE 在 Release browser gates，精確位置 live-private-commerce-journey.spec.ts:58（登入後 dashboard assertion），根因尚未確認，禁止合併或將舊 PASS 冒充最新。
- F2 post-purchase 最新來源158 unit/12 files、普通 TS/scoped ESLint PASS；第一 actual browser runner terminalFAIL（26 DB/86migration PASS、browser unexpected1、無skip/flaky、cleanup PASS，source11c76202，歷史failure新docs保留）。已修 browser ShippingFulfillment.orderItem 關聯、checkout page helper 拆分（不降低complexity gate），加入closed stage/status/location診斷。第二browser session32434 LIVE；Node TAP56794 LIVE。獨立Critical review dispatch2/4，首次canonical wrapper BLOCKED_SENSITIVE_INPUT且attempts=[]/沒有模型呼叫；依既有canonical plan native Astra/high fallback唯讀helper審查中，observed unknown，非Claude unavailable。未READY/PR/交付，Goal完整範圍仍ACTIVE。

- F2 post-purchase 2026-10-07：native Critical review dispatch 2/4 回報 2 MAJOR、1 MINOR；新增設定選項保留與兩段確認修正，36 unit PASS。完整 Node TAP LF mirror 1067/1067 PASS、零 skip，歷史 checksum 未修改。最新 TS 顯示 existing-product select 缺少 policy 欄位，待當前 source-frozen browser session 75785 終止後修正；candidate NOT_READY、尚無 PR。

- F2 post-purchase 最新候選：商家選項保留與 CAS 所需 select 修正；169 unit/12 files PASS、零 skip，TS/scoped lint PASS。86 migration/26 DB PASS；browser 已實際通過商家登入、設定保存、下架目標後描述保存與合成 settled source，舊候選在匿名 HTTP 404 assertion 失敗。新增授權 Route Handler 入口與 8 權限 unit，保留原 HTTP 404 assertion。當前 browser session 11199、source-bound LF TAP session 82954 執行中；付款 failed/expired credit recovery 的 MAJOR 未完成、review 2/4、NOT_READY、無 PR。

- F2 post-purchase checkpoint 5c969b654896eb07fb1f7ec84a2db9827a88d547/tree14454aab4a1c598761b363b3cfe6e2cd623103e5 pushed; exact push CI37579069131 IN_PROGRESS. Latest recovery inventory correction: source e5c9cac83471d196fcd8f39941224a6b01c5df0c230aca92cc5136d7af8dfc55,86 migrations/31 DB/169 unit/zero skip/cleanup PASS. Added original failed/expired reservation reacquisition once, sold-out rollback, tenant rejection and refunded-source guard regressions. Provider state verification and actual buyer recovery still incomplete; review2/4,NOT_READY,no PR,no merge. Prior browser91704 PASS and TAP69175 1067 PASS terminal; these precede the new recovery source and cannot prove it. Original dirty checkout untouched.

- F2 post-purchase unissued preparation recovery implemented in real recovery API: explicit server unissued/issued marker, provider local-preparation capability, current source/buyer rights, immutable payment/order net identity, serializable original stock reacquisition and three-conflict bounded retry. Fresh86migrations/37DB/173unit/zero skip/cleanup PASS at b98513260e96ff8642eda8c47573d1fca555d444356aadb5519bac6bc8a12b57; TS/scopedlint PASS. CI37579069131 terminal FAILURE in existing live-share flow mock export; partial mock now retains actual exports and exact1test PASS, fullCI pending. Source frozen for actual browser30472 RUNNING, synthetic unissued preparation failure explicitly marked. Issued/expired provider recovery remains MAJOR,review2/4,NOT_READY,no delivery PR. Original dirty checkout untouched; failure receipts preserved.

- F2 post-purchase browser30472 terminal PASS: fresh86migrations/37DB/173unit/1 actual merchant-buyer browser/0skip/flaky/cleanup/source unchanged,source5d5599a819455d3d506bc2cbd53c3fda7980d5f31bf022eb47c651c076d2b20d. Explicit synthetic unissued-preparation failure→reload→real recovery API preserved original transaction/order/net9500/onecredit; partial source refund subsequently rejects recovery and cancels shipping. TS/scopedlint PASS. Checkpoint36bb661166406c82929f6bf4b9c424fc081eb846/tree6362772e09e103898d39fce52eb45af71e2de39c pushed, fresh exactheadCI pending. Previous CI37579069131failure and DB3failure retained immutable receipts; no threshold/assertion reduction. Issued/expired provider state recovery still MAJOR; independent review2/4 pending full corrections,NOT_READY,no PR/no merge.

- F2 manual issued/expired recovery implemented in same real API with exact original session payload/payment/order/net credit, source rights, serializable final-unit reservation and late-paid rejection. Initial42DB/173unit/86migration/zero skip/cleanup PASS at6784c377a779ccfb2a53108c737785fdecaa11bccb4aeb9708f896264cbfc189. Previous exact36bb CI37580991693 terminal strict-index FAILURE: three unchecked item accesses; explicit validated item correction now TS/strict-index/scopedlint PASS. Added paid-order/pending-payment mismatch guard, in-transaction recovery events, final43DB/173unit/actual synthetic manual-expiry browser72057 RUNNING and source frozen. Re-fetched masterf739unchanged,F1PR370 MERGED,F3PR372 OPEN/f24993f8. External issued PayUni recovery and exact result-page entry remain incomplete;review2/4,NOT_READY,no delivery PR/no merge.

- F2 manual expiry runner72057 terminal PASS at d7ef1ab1d0f89f104b9f5d44212baedee0fbd62d03df01cd3ab68d54b878e174:86 migrations/43 DB/173 unit/1 actual merchant-buyer browser/zero skip/flaky/cleanup/source unchanged. Actual synthetic unissued+expired manual recovery reused same original payment/order/payload/net9500/one credit and two atomic recovery events; source partial refund rejects subsequent recovery. TS/strict-index/scopedlint PASS; exact checkpoint30475c8740ff330840d52cb15d598a2ad452a3f3/tree0edcaea6bac3282cf5e68a562ccda61f734effa4 pushed, freshCI pending. Previous36bb strict-index failure retained and fixed explicitly. External issued PayUni recovery and exact result-page recovery entry still unfinished;review2/4,NOT_READY,no delivery PR/no merge.

### 2026-10-07 Q2 protected delivery

Q2 #379 DELIVERED: accepted head `3d32b0a029bedb83912b29e38f54a6c59b38b47b`, protected squash `a10728f4147ce84ad6d33524ed0e412660602283`; both trees `7c40ca931b3d5d076edbbfc010aee141b0e7fd7d`. Explicitly authorized fifth readonly review passed with no findings; 87 migrations, 67 DB regressions, 2 browser journeys, canonical acceptance and exact-head push/PR CI 37593163815/37593169648 passed. Synthetic non-Production scope only. F1 notifications head `7917b66c` CI 37594673075 passed; remaining physical/service admission, exact payment-source refund isolation and provider proof still NOT READY. Overall Goal remains ACTIVE.

### 2026-10-07 F1 notification resource and exact payment isolation

F1 learner-notifications IMPLEMENTED NOT READY: physical/service owned fully-paid unrefunded orders now admit notification consent/proof without fabricated entitlement; digital/course retain active grant and expiry. Payment notices bind exact encrypted original order and lock it through dispatch; a different active same-product purchase cannot authorize a refunded source. Current 90 migrations/80 DB regressions/50 targeted unit/TypeScript/scoped lint PASS. Fresh seven-browser runner 75543 and original task final independent review 4/4 are active. Prior five-browser proof is historical scope only. Approved external provider evidence, main integration, gate, exact-head CI and PR delivery remain. Overall Goal ACTIVE.


Q2 分支既有 checkpoint：

### 2026-10-06：AGY 修復交付與 Q2 接續

| ID | 精確來源／相依 | owner | 驗收與新證據 | 實際狀態／剩餘 |
| --- | --- | --- | --- | --- |
| AGY-Claude | 修復 head `cc4070206340200acf3a10cd7ba558bda0dcb4bb`；PR #377 squash `5a25018d87fdfd780286107136968121088a9ac7` | root writer；一名 readonly reviewer，dispatch 2/4 | 兩個 Claude slug 各 40,093 字元實際 wrapper PASS；完整 routing/resilience、UTF8、超時與截斷回歸 PASS；獨立複審 findings=[]；canonical READY；push/PR CI `37407696287`、`37407703413` SUCCESS；accepted/merged tree 均 `bef8cd0de500e2817513006b35af7c210ca09006` | DELIVERED；不代表任何產品批次已交付 |
| Q2 | `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`；現行固定非 Production owner/buyer/subscription/ops 契約 | root writer；task dispatch 1/4 | 新增歷史 buyer 精確 source/tenant/checkout、單筆退款、重複事件及跨產品拒絕回歸；補正 recovery HTTP status 與既有 runner 契約；本次 targeted 67/67 PASS；先前 disposable PG 86 migrations、54/54 PASS 保留 | IMPLEMENTED_PARTIAL_VERIFICATION；尚需 buyer/callback 實際 DB、完整 workspace browser、Critical review、canonical acceptance、精確 head CI、PR；外部 sandbox secret/proof 尚缺，不能宣稱真實退款成功 |

### 2026-10-07：Q2 Critical 修正與 CI 相依更新

| ID | 精確來源／相依 | owner | 驗收與證據 | 實際狀態／剩餘 |
| --- | --- | --- | --- | --- |
| Q2 | `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`；候選基底 `f66b5f0` | root writer；Critical task 3/4 | 新 forward migration：87 migrations、61/61 DB PASS；36/36 targeted unit、TS、lint PASS；新真實簽章 callback route 與 browser 最終回歸執行中；`remaining-capabilities-q2-review-fixes-20261007.json` 綁定產品與測試 hash | IMPLEMENTED_PENDING_FINAL_VERIFICATION；並行 retry、最新 browser、最後一次複審、canonical acceptance／CI／PR 尚未完成，不宣稱交付 |
| CI-sharp | head `85aa6e43b97858592364b8c6041d72b83c5284e6`；PR #378 | root；獨立 Critical reviewer，3/4 | production audit 0；實際 native SVG/PNG PASS；findings=[]；canonical READY `a2c0fb7c`；精確 head push／PR CI 執行中 | VERIFIED_PENDING_DELIVERY；CI 全通後 protected expected-head merge，再接入其他候選 |

### 2026-10-07：現行交付狀態核對（優先於前述歷史 pending）

以下為 GitHub PR 狀態及本機 Git tree 實際比對；不以 ancestry 單獨判定功能完成。原始 dirty 專案及歷史收據未改。

| ID | 精確來源／head | 相依與 owner | 驗收／新證據 | 實際狀態／剩餘 |
| --- | --- | --- | --- | --- |
| F1.1 | PR #370 head `84cdb47567bbc85e3eee43b2557fc899507907d8`；merge `728f0e591c0a5d4a83fe98d6a98146f9d7d0d842` | 現行 portal auth/購買權益；root | 84 migrations、7 DB、1 actual browser、1067 Node TAP、Critical review、canonical READY 與完整 CI；本次 accepted/merged tree 同為 `8cbbcc07a75af21815d57ec9b276517293fe1486` | DELIVERED；F1 社群、多語/PWA/push、通知/SMS/WhatsApp 仍須完成 |
| F2.1 | PR #374 head `ff9ea27896689d9983a203832993b22e4d33097b`；merge `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73` | tenant/member/CAS/immutable ledger；root | 9 unit、85 migrations、6 DB、1 actual browser、1067 TAP、Critical review、canonical READY 與完整 CI；accepted/merged tree 同為 `4f63c92d6c24e6585484912863704b3ecffd1f43` | DELIVERED；F2 階梯/多層、扣繳/payout/export、推薦/加購/tracking/webhooks、私訊/廣播仍進行中 |
| CI-sharp | PR #378 head `85aa6e43b97858592364b8c6041d72b83c5284e6`；merge `f739c7e017d430f05cc10a85728f5335e1bc20be` | Q2 與其他批次 CI 相依；root | production audit 0、actual native image PASS、Critical findings=[]、canonical READY；push `37495923811`／PR `37495934523` SUCCESS；accepted/merged tree 同為 `8c75ffb60a78fdc814e38c34e30b4777e4f3cd38` | DELIVERED；需各候選接續主線及按影響驗證 |
| Q2 | 來源 `eac0a3430df3ca0beed06a9c63cbd2cb13414fa7`；產品修正 head `ff09b43b580a08b3c598f29844754ac688488985`；CI inventory head `b0362e3aca7624b2312a34535c5a60f19bfd1c52` | 固定非 Production；root writer；independent Critical reviewer dispatch4/4 | server-owned tenant/payment ID 經 dispatch 與 Serializable transaction 綁定；兩項新 real PG race/identity regression PASS；產品獨立 review findings=[]、observed unknown。87 migrations；67 DB 首次66 PASS/1 existing settlement FAIL/0 skip；CI inventory/API 同路徑回歸146 PASS、lint/TS PASS。最新完整 DB+2 browser及精確head CI執行中 | IMPLEMENTED_PENDING_ACCEPTANCE；尚未 READY/PR/交付；不得把本機合成 callback 說成外部真實退款 |
| F3.2／F1.2／F2.2 | 既有隔離候選與 checkpoint 保留 | root；各 task dispatch4/4，額外review授權尚待 | 已有實作及 DB/browser 證據，但最新候選必要獨立review尚未完成 | REVIEW_BLOCKED；不換task逃limit，不妨礙其他工作 |
| F1.3 | PR #375／隔離 portal-localization-pwa 候選 | root；review3/4 | 多語/PWA 已有 unit/DB/browser 證據；最新主線與社群整合待驗證 | IMPLEMENTED_PENDING_INTEGRATION_ACCEPTANCE |
| Q1 | Draft #371 head `561ffdfe57d6192ed472055846575aa8846a33d9` | 精確 PENDING_REFUND transaction、核准 sandbox secret 注入 | 76 unit、83 migrations、8 DB、Critical review；browser/provider proof 未完成 | EXTERNAL_BLOCKED；不得 mock 退款成功或選 latest 訂單 |
| A1/E1 | 已列精確歷史來源／每批 revision | F1/F2/Q1/Q2；root | canonical vNext 與本次 revision/head 證據持續補齊；保留歷史資料 | IN_PROGRESS；完整 Goal 尚未 COMPLETE |

Q2 latest exact candidate `b0362e3a`：87 migrations、67/67 DB、2/2 browser、0skip/flaky及cleanup PASS；產品revision `27323082`獨立review findings=[]，canonical assess_acceptance READY。永久新證據 `remaining-capabilities-q2-local-receipt-20261007.json`；精確新head CI及protected PR仍待，Goal IN_PROGRESS。

已交付主線 checkpoint：
本次整合 `origin/master` `daa6372a6e0f060e93de2c2e10afa0c9c4d09c73`：F2.1 #374 已受保護 squash merge，accepted/merged tree `4f63c92d6c24e6585484912863704b3ecffd1f43` 一致。F3.2 Save acknowledgement 最新source `4ab03f...` 本機全部回歸通過、medium canonical READY；最新獨立review受同task dispatch4/4限制仍待授權。整合後驗證與CI待執行，未交付。
