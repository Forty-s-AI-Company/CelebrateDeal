# G7-04 CommerceOrder、付款、退款與履約 checkpoint — 2026-08-08

## 結論

- 狀態：`PASS_LOCAL_DETERMINISTIC_BROWSER_EXTERNAL_ACCEPTANCE_PENDING`。
- 「訂單／履約」由 provisional `2/10` 調整為 local-evidence candidate `8/10`。
- 「Checkout／付款」由 provisional `6/10` 調整為 local-evidence candidate `7/10`；fresh PayUni Sandbox 尚未執行，因此不是 release acceptance。
- 「退款／客服」保守維持 local-evidence candidate `6/10`；正式退款政策、客服 SLA、真人 owner 與 Sandbox 證據仍未完成。
- canonical total 維持 `73.5`、delta `0`。本文件不取代 RELEASE-RECONCILIATION，也沒有把 candidate 分數寫回 canonical CAT01～CAT10。
- Reviewer 發現 `0 P0 / 1 P1 / 3 P2`；P1 與三個 P2 均已修正、補測並關閉。
- 本工作包已達可安全停下的 checkpoint；下一個最高產品價值工作是 `G7-05 — 視覺報名表單 builder`，本輪未啟動。

## 實際完成的產品閉環

### Canonical order 與付款

- 新增 tenant-scoped `CommerceOrder`、`CommerceOrderItem`、事件、退款、實體配送、數位授權與服務履約模型，付款交易與 canonical order 有明確身份綁定。
- Checkout 以單一 transaction 建立庫存 reservation、付款交易與 order；錯誤時整體回滾，不留下孤兒訂單或假成功。
- trusted checkout metadata 與 provider callback metadata 分離；callback 不可改寫 vendor、product、buyer、金額或幣別等可信身份。
- paid、failed、expired、partial refund、full refund 都會收斂到 order 與 fulfillment；重送以 deterministic event identity 去重。
- canonical commerce checkout 在付款後保留 idempotency key；瀏覽器重試會得到有限且可理解的已完成結果，不再建立第二筆交易。

### 商品交付類型與既有商品保護

- 商品可明確選擇 `physical`、`digital`、`course`、`service`，並由 server 驗證後建立對應 fulfillment。
- 歷史 course 商品自動標記為 `course + confirmed`；歷史非 course 商品不再默認可售，而是 `physical + unconfirmed`，必須由商家確認後才可進入 Checkout、Live、互動腳本、團隊模板或夥伴頁選擇器。
- 新商品預設 `physical + confirmed`；商品列表與表單會標示「需確認交付方式」，不把 migration 猜測冒充商家決定。

### 商家訂單與履約 UI

- 新增 MFA 保護的訂單列表與詳情；查詢同時綁定 `order id + current vendor id`，跨租戶 URL 顯示中文 not-found，不洩漏 order number 或 PII。
- 買家與配送 PII 使用 AES-GCM envelope，AAD 綁定 vendor/order；列表只顯示 mask，詳情只有通過 MFA 才解密。Browser 驗證 HTML 不含 encrypted envelope。
- 實體商品可完成 `pending → packing → shipped → delivered`，每一步有 CSRF、pending/disabled/live status、revision optimistic concurrency 與事件紀錄。
- 數位／課程 entitlement 完整退款後改為 `revoked`，並清除 encrypted access envelope 與 mask，不保留可繼續使用的能力。
- 服務履約支援排程與完成狀態；正式退款仍明確導向平台財務 MFA 流程，商家頁不假裝能自行完成 provider refund。

### Build、accessibility 與 RWD closure

- 移除 production build 對 Google font 外部下載的依賴，改用本機 system font stack；hermetic network guard 下可完成 Next production build。
- 修正 Next 16 PageProps 不允許整份 props 為 optional 的頁面簽章。
- 將 Cloudflare webhook factory、preview lineage helper 與影片上傳常數移出 Route Handler；route module 只 export Next 允許的欄位。
- 修正 footer 12px 文字的 color contrast serious finding，沒有關閉或縮減 Axe 規則。
- PageHeader、訂單編號、email 與商品名稱支援窄畫面安全換行；完整 hydrated 390×844 訂單頁水平 overflow 為 `0～1px` 合約內。

## Fresh deterministic evidence

### Pure unit／component／route matrix

- 命令：`npx vitest run <37 explicit non-DB test files>`。
- UTC：`2026-08-08T05:10:41.3868112Z` 至 `2026-08-08T05:11:04.3470928Z`。
- 結果：`37 files / 372 tests PASS`，failed `0`、skipped `0`、exit `0`。

### Disposable PostgreSQL

- Receipt：`.ai-team/reports/g7-04-commerce-disposable-20260808.json`。
- Receipt SHA-256：`A044837E081C1962ED67D3B9376B277695E6E907981CDEC73F59276E6B97D5C9`。
- Run：`c387a7638f8ff71b`，UTC `2026-08-08T04:06:38.253Z` 至 `2026-08-08T04:07:05.227Z`。
- 結果：37 migrations；validate、deploy、status、歷史商品 backfill、commerce integration 全部 `PASS`。
- Test：`4 suites / 75 tests PASS`，failed `0`、skipped `0`。
- Safety：loopback-only、PostgreSQL tmpfs、synthetic fixtures、無 persistent volume；container 與 temp root cleanup 均 `PASS`。

### Production build 與 Browser

- Canonical receipt：`docs/ai-team/evidence/g7-04-browser-qa-93e5ed96890d253c.json`。
- Receipt SHA-256：`3BBF94A1BD4ED5D562E8CE7C7C4DEA470A2C21648021397CFAB23D70A217FF27`。
- UTC：`2026-08-08T05:06:04.527Z` 至 `2026-08-08T05:08:21.951Z`。
- Next production build、server、37 migrations、Browser 全部 `PASS`。
- Browser：`2 passed / 0 failed / 0 skipped`。
- 驗證：desktop 履約、DB revision 2/3/4、tenant isolation、PII envelope absence、Axe critical/serious `0`、390×844 RWD、keyboard skip-link focus 全部 `PASS`。
- Desktop screenshot SHA-256：`6A920C5ABDFD57415B3A89A546B398431F5840F28E57DAE00DF64379D2CF92AB`。
- Mobile screenshot SHA-256：`1BC6A85B3DAC47749FA6D44DE054363332FB9D984215DDB4008B64FF8C23810D`。
- 已目視確認兩張圖；mobile 是完整 hydrated 訂單頁，不是 loading fallback。
- Safety：不讀 `.env*`，只用 synthetic env、loopback server、tmpfs DB、既有 Playwright browser cache；沒有讀 Chrome profile／Cookie，也沒有外部或 Production 操作。

### Static verification

- Scoped ESLint：41 個 G7-04 source/test/runner 檔案，exit `0`；未新增 disable。
- TypeScript：`npx tsc --noEmit --pretty false --incremental false`，exit `0`。
- Schema contract：`npx tsx scripts/g7-commerce-order-schema-contract.test.ts`，`PASS`。
- Browser runner parser：Node test `4/4 PASS`，涵蓋正確計數、敏感值遮蔽、Axe 與 RWD 診斷。
- 93-entry source scope 的 `git diff --check`：exit `0`；只有 Git 預告的 LF/CRLF working-copy warning，沒有 whitespace error。
- Source manifest：`docs/ai-team/evidence/g7-04-source-manifest-20260808.txt`，93 entries、0 mismatch。
- Source bundle SHA-256：`ACFB1EEEA6AFD26E54E81B7FE1D51CD4D2608E804E7297224DB2631BCBDB9C07`。
- Source manifest SHA-256：`89C2044E9581ABAFF06B3A51403B9F6E35B01BBAE4522C0635C579C0516A7474`。

## Reviewer findings 與 closure

1. `P1`：PayUni 同一 trade 的第二筆合法 partial refund 共用 event identity，可能 collision／rollback。改為綁定 provider trade、pending RefundRecord 與 request reservation；連續 partial refunds 可獨立且可重送。`CLOSED`。
2. `P2`：付款後清除 canonical checkout key，browser retry 可能建立第二筆交易並在 order unique constraint 變 502。canonical commerce 現在保留 key；只有非 CommerceOrder 的 generic billing checkout 清除。`CLOSED`。
3. `P2`：full refund 只把 entitlement 標 revoked，仍保留 encrypted access capability。現在 full refund 同時清除 access envelope/mask，migration 增加 lifecycle check。`CLOSED`。
4. `P2`：migration 把歷史非 course 商品靜默視為 physical。改為 fail-closed `fulfillmentTypeConfirmed=false`，商家確認前不得販售。`CLOSED_IN_CODE / HUMAN_CLASSIFICATION_PENDING`。

Closure review 沒有新增 P0/P1。訂單列表 pagination、買家自助入口／email delivery 與商家退款政策仍列為後續 P2／獨立 WP，不冒充本工作包已完成。

## 執行中失敗與 superseded evidence

- 所有 `g7-04-browser-qa-*.json` 失敗 receipt 均保留；曾依序揭露 Next PageProps、route export、browser cache、streamed not-found、locator strictness、Axe contrast 與 mobile overflow。每次都使用不同診斷或產品修正，沒有把失敗改標 PASS。
- `g7-04-browser-qa-cee8d48f0f4007fe.json` 曾機器判定 PASS，但目視發現 mobile screenshot 仍是 loading fallback，因此明確 `SUPERSEDED_NOT_ACCEPTED`；只有 `93e5ed96890d253c` 是 canonical Browser evidence。
- `2026-08-08T05:09:45Z` 的 38-file consolidated run 為 `37 files passed / 1 file failed`；失敗檔 `payment-webhooks.test.ts` 誤連到未套 G7 migration 的既有本機 schema，44 個失敗皆為缺少 `CommerceOrder` table／`fulfillmentType` column。此結果保留為 `INVALID_DB_ENVIRONMENT_FAIL`，未當產品 PASS，也未重跑同一命令。
- DB integration 隨後沒有改接未知本機 DB；只採用上方可追溯的 disposable PostgreSQL 75/75 receipt。

## 兩份指定報告的 attribution

- `docs/report-1-affiliate-and-course-revenue-logic.md` 已讀；SHA-256 `21F44609BDFD0735458F178BD0825B32F26F60EA37D2290E37AC80EE93A588FB`。G7-04 保留 PlatformReferral、MerchantAffiliate、CourseCommission domain 分離，沒有把 CommerceOrder refund 誤用成另一 domain 的分潤規則。
- `docs/report-2-current-implementation-readiness.md` 已讀；SHA-256 `69871A7B6C5A68271EF427F514E3F6478A6D623049036F79F4F49BBA27881483`。它只作歷史缺口索引；本 checkpoint 以 current source、DB、Browser 與 fresh tests 為準。

## 外部與人工 blocker

1. 歷史非 course 商品需由商家真人逐筆確認 fulfillment type。最小證據：merchant owner、UTC、product id、選擇類型、理由、確認前後狀態與 sanitized screenshot/hash；不得包含客戶或付款資料。
2. Fresh PayUni Sandbox 仍需完成 paid、兩次 partial refund、full refund 與 retry/idempotency，並保存 provider transaction identity 的 sanitized receipt。不得操作正式付款或退款。
3. 退款政策、客服 SLA、財務 owner、release owner、法律／隱私／條款仍需真人簽核；AI 不代簽。
4. 買家 order portal、email entitlement delivery、訂單 pagination 與 merchant refund request UX 尚未完成，可在後續功能 WP 推進。

上述事項目前不要求使用者立刻手動處理；已建立清楚格式後先跳過，不阻擋下一個 AI 可完成的高價值功能。

## Ownership、回滾與下一步

- Source HEAD：`1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`。
- final worktree：620 dirty entries（201 tracked dirty、419 untracked）、staged `0`；所有既有 dirty 內容維持 `PRESERVE_ONLY`。
- 未 stage、commit、push、merge、deploy；未執行 Production DB、付款、退款、寄信或 provider mutation。
- 未降低 coverage threshold、assertion 或資料驗證；未新增 skip、exclude 或縮減 inventory。
- 未重跑 FIN-08AA、WP-196、WP-197 的 terminal no-go endpoint、probe 或失敗命令；也未把其失敗分類為 schema drift。
- 回滾必須依 93-entry source manifest 反向套用 G7-04 精確 hunks，並精確移除 G7-04 migration、新增 order/fulfillment files、runner 與 evidence；禁止用 reset／restore／checkout 覆蓋共享 dirty files。
- Disposable container、schema temp root 與 loopback server 已清理；沒有正式外部狀態需要回滾。
- 下一個最高價值工作：`G7-05 — 視覺報名表單 builder`。Goal 保持 `ACTIVE`，本 checkpoint 後停下。
