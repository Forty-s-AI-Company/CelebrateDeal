# 新 session 接續說明

整體 Goal `remaining-capabilities-20261005` 未完成。只承接實際 checkpoint，不能把本機成功或歷史收據當成 final head 驗收。

## 工作位置

- 主 worktree：C:/Users/eden/Documents/Codex/2026-10-05/new-chat/work/CelebrateDeal；分支 codex/editor-advanced-interactions-20261006。
- F1 worktree：C:/Users/eden/Documents/Codex/2026-10-05/new-chat/work/CelebrateDeal-course；分支 codex/remaining-course-learning-20261006。
- 原始 C:/Users/eden/Downloads/AI/CelebrateDeal 的 dirty 工作保留，禁止 reset/clean。
- 最新已核對 master：2319c742f1455681ff08b720c193a2faf1545e27；接手時重新 fetch，不能假設仍最新。

## 已交付

F3.1 #369：parent echo、外部文件同步、undo/redo session lifecycle；14 unit、9 Chromium、精確 head CI，受保護 squash merge；accepted tree 與 merge 一致。

## 待交付

F1.1 #370 head 1d5bff45499473cdc35e0a017ba03e7aaf32949e：原生商家單元發布、權益播放器、進度/續播/完課證書及退款撤權。84 migration、7 PG regression、1真實UI旅程、Critical review與canonical READY；最新CI仍在執行/排隊。CI修正後full Node TAP1067/1067，零skip。資料與API產品source hash af23858c6b7e1f20843b0a639a7ac92b20fc6b44bf5f25bc5f5485c0a9492989 未改。CI correction task dispatch3/4，不得假開新task逃避limit。

F3.2：目前分支checkpoint包含實際workspace多步驟flow、bounded50 history、canvas history barrier、模板/popup流程及新disposable PG browser。初次完整harness與PG登入Save/reload/跨租戶旅程成功，但後續review修正使那些browser證據失效。最新 lint/typecheck及8unit成功；尚需加入拒絕幽靈內容、刪中間步驟再新增path、有效step動作測試，重跑完整browser，獨立複審新runner/config/E2E及修正，canonical gate，PR與精確headCI。三項findings詳見checkpointJSON。F3 task dispatch2/4（Sonnet CLI失敗+native Sol high reviewer）；observed unknown。舊onStepMutation已移除，workspace仍使用既有auth/CSRF/CAS全量draft Save，不新增會覆寫canvas的背景metadata契約。

Q1 #371 Draft head561ffdfe57d6192ed472055846575aa8846a33d9，branch codex/refund-qa-exact-transaction-20261006：76targeted unit、83migration/8DB、Critical reviewPASS；canonical BLOCKED browser。PR CI37365296110 FAILURE（尚未定位），push37365229609 CANCELLED。不可合併。需要核准注入JOB_SECRET與PAYUNI_SANDBOX_MERCHANT_ID/HASH_KEY/HASH_IV，及精確current-source合成付款handoff，MFA如实际要求；不得挑latest或另換交易。現有finance email/password注入存在只觀測boolean，不輸出值。Q1 task dispatch2/4。

## 未完成範圍

F1社群、多語、PWA/push、SMS/WhatsApp；F2affiliate/階梯多層佣金/扣繳payout匯出/referral/upsell/tracking-webhooks/私訊廣播；F3team/video及尚未證明的popup/template/flow完整需求；Q2owner/buyer/subscription recovery與ops；A1有用歷史app/workflow依功能遷移；E1每批新sanitized exact-revision證據。精確來源依matrix及branch-integration-deferred-work-20261004.json取得，不重新展開歷史refs。

## 接續規則

讀AGENTS.md、branch報告/JSON與canonical docs及routing-policy；最上方最新checkpoint优先。root唯一writer+最多1readonly helper，depth1 dispatch4，不遞迴；依canonical最低足夠model/effort，fallback真實原因，observed unknown不冒稱。每候選canonical assess_acceptance/MCP assess_task、獨立review、exactheadCI，無blocking findings再保護流程expectedhead squash；合併後比對tree。

不讀.env*、secret或Production資料，不forcepush/master直推、不降tests/coverage/skip/exclude。允許synthetic非Production及approved injection/disposablePG。每次改Next先讀本機對應版本文件。更新matrix/report/Goal，不宣稱全部COMPLETE。
