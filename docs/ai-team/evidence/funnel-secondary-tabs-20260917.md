# Funnel secondary tabs checkpoint — 2026-09-17

## Scope

完成 Automation Rules、A/B Test、Stats、Leads、Sales、Deadline Settings、Funnel Settings 的持久化、管理 UI、公開 runtime 與來源驗證。入口：Funnel 編輯器上方「Funnel 管理」。

初始工作目錄 clean；本輪依使用者要求切換 ai-team-pro。沒有操作正式資料庫、付款、寄信、production deployment、push 或 merge。

## Schema / event evidence

- additive migration `20260917100000_funnel_runtime_attribution`；新 `LandingPage.operations`、`FunnelVisit`、`FunnelSubmission` 及 `AutomationRule.funnelPageId`。
- visited actual/logical step 分開保存；FormSubmission + FunnelSubmission 同 transaction；duplicate 不重寫來源。
- bounded reports 使用租戶+專案+page scope；Leads 只選 ID/time/status；Sales 只讀 trusted paid Order/Payment projection。
- settings 共用 revision CAS；engine allocation 鎖定並拒絕歷史 experiment identity 重用。
- Deadline 用 absolute instant；IANA 時區明確顯示；SSR、native forms、checkout 與 Webinar/play 入口維持同一限制。

## Review

獨立 Terra review 找出 Webinar 早期 return 繞過 deadline 與 missing-visit provenance 問題，兩項皆已修正並完成唯讀複驗。operations service 的 CAS、tenant scope、PII projection 與 Sales source 複核沒有未解 findings。聚合已改為預先分組，避免每步重掃所有 visits。

## Verification executed

- Operations / service / flow / landing-page service / actions：62 tests PASS；新增歷史 experiment identity guard 後 operations/service/runtime-contract 組合 31 tests PASS。
- Runtime regression：8 files / 63 tests PASS，涵蓋公開 route、Webinar、play、proxy、checkout 等。
- Automation：4 files / 22 tests PASS。
- Runtime contract：1,000 deterministic assignments、weight range、stop/winner、Taipei / New York DST 重複時段 / Berlin 邊界、expired redirect write denial、tenant source query。
- Changed TypeScript/TSX scoped ESLint PASS；git diff --check PASS。
- Isolated runner 第一次/第二次如實 FAIL at typecheck：先修 public union narrowing 與 JSON cast，再修 form POST inferred undefined；未降低 assertion 或跳過測試。
- Browser 驗證發現並修正 Automation 初始載入期間可送出 mutation、明確 reload 未重設欄位，以及公開表單錯用舊 team visitor cookie 的問題。原生表單 reserved fields 同步加入 funnelStepId。
- 加入實際 POST cookie regression；公開表單 HTTP 200、FunnelSubmission、Leads submission ID 與 Automation tag 已取得瀏覽器證據。Synthetic Sales fixture 改用既有資料庫要求的 SHA256 base64url identity hash，沒有放寬 CHECK。
- 測試導覽補上感謝頁與管理頁 ready 條件；requestfinished 事件取代會在 teardown 拋錯的 response.finished 觀測。負向跨租戶路徑發現 React 419；局部 not-found 邊界無效，因此改用預期的 unavailable UI 回傳值，仍要求 browser errors 為空。不存在與無權存取使用相同泛用畫面，不載入報表；未知 DB 錯誤仍拋出。這是 authenticated 管理 UI 狀態，不宣稱 HTTP 404；tenant FK 與禁止洩漏其他商家資料的 assertions 保留。
- 最終 isolated receipt：`funnel-operations-20260917/receipt.json`，完整 journey **PASS**；87 個 migration、85 項 targeted tests（含實際 DB concurrency）、typecheck、production build、Browser 與 owned-resource cleanup 全數 PASS。Browser 保留零錯誤 assertion，涵蓋七分頁儲存/重載、雙編輯器 revision 衝突、穩定 A/B、Automation 建改啟停、可信提交/Leads、Sales projection 排除 client event、期限前後/導向及跨租戶拒絕存取。
- 最終執行命令：`node scripts/funnel-operations-disposable-qa.mjs --refresh-build`。可從零建立新 mirror：`node scripts/funnel-operations-disposable-qa.mjs`。只使用 loopback disposable PostgreSQL；Sales 為 synthetic projection，不是 provider payment 驗證。
- 主代理已另行核對工作目錄 production/test/browser SHA256 與 PASS receipt 完全一致：production `e6c20a6632f0124a635f205dc9a65e6c79e14d8aff726284aaa430883757007b`；tests `7f48197358e09516ba70a27bdbe0856590effaa9b00458dd9866cf326697802a`；browser `c715698f6853d30cd3c053e6b520fb862f07245f8e659ed5d3053ff520f5a72d`。
- 已檢視成功 synthetic 截圖 `funnel-operations-20260917/operations-settings.png`；不是 loading skeleton。歷次失敗 receipts 保留，沒有改寫為通過。

## Rollback / deployment

以本輪 commit 精確 revert application change；保留 additive schema 與來源資料，不 DROP。不需觸碰未知使用者變更。實際部署時需先套用 additive migration，再部署 application；本輪只驗證 disposable loopback PostgreSQL。

既有 GitHub Actions CI 在 push/pull_request 跑 ESLint、型別、unit/coverage 與 E2E；新 tests 納入既有 gates，未新增自動 production deployment。
