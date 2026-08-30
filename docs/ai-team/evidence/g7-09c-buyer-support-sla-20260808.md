# G7-09C — 買家客服入口、客服角色與 SLA 閉環

- Evidence time：`2026-08-08T15:38:04.9814922Z`
- Workspace HEAD：`1a8a4bb3acad8aabef30a7d9fbe4dc1488d6a758`
- Mode：`PRELAUNCH_DEV_AUTONOMOUS`
- Verdict：`LOCAL_BUYER_SUPPORT_AND_SLA_PASS`
- Final reviewer：`NO_P0_P1`
- Production／staging／provider／正式付款／退款／Email／deploy 操作：`0`

## 實際完成的產品功能

1. Checkout 成功回應會為 exact vendor/order 建立 browser capability；raw token 只放在 `HttpOnly`、`SameSite=Lax` cookie，資料庫只保存 SHA-256 hash。公開頁不接受訂單編號或 Email 作為所有權證明，也不把 token 放入 URL 或 JSON。
2. 新增 `/support/requests` 與 `/support/requests/[id]`。買家可從同一瀏覽器建立案件、查看只標示為 `buyer` 的事件並回覆；純內部案件不會出現在清單、detail 或 mutation boundary。
3. 買家建立付款／退款案件時由 server 派生 `P1`，其他案件為 `P2`；`responseDueAt` 與 `firstRespondedAt` 分開保存。內部 note 不會冒充首次客服回覆，只有 buyer-visible customer reply 才會完成 first-response timestamp。
4. 新增 least-privilege `support` role。它只能進客服 queue 與自身安全設定，不具有 manager、finance、退款交接、訂單管理、成員管理或 billing 權限；退款 handoff 仍要求 manager，canonical refund review 仍要求 finance admin。
5. Public mutation 有 CSRF/origin、IP＋grant rate limit、production durable-provider gate、revision CAS、dedup key 與 generic failure boundary。`cloudflare_waf` 現在與既有 production env policy 一致，不再因永遠 `configured=false` 使整個買家客服功能失效；外部 WAF 是否真的部署仍屬 release evidence。
6. Buyer mutation 不再於 commit 後旋轉 capability，避免資料庫已成功但 `Set-Cookie`／redirect 遺失時永久鎖住買家。Checkout idempotency key 改存同 tab 的 `sessionStorage`，refresh／503／response drop 會續用同一筆；只有輸入變更、無外部動作的成功完成，或頁面真的觸發 `pagehide` 離站後才清除。
7. Commerce checkout destination 改成 fail closed：只允許 same-origin，或 `payuni` provider 的兩個 exact UPP endpoint；任意 HTTPS、額外 query string 與非核准 provider destination 都會被拒絕。
8. 資料庫以 composite FK／check constraint 強制 buyer grant、case creator、event actor、vendor、order 與 audience 一致。SupportCaseEvent 的 buyer actor 同時綁 exact grant order 與 exact support-case order，不只依賴 application code。

## Deterministic verification

- Final targeted Vitest：`14 files / 129 tests PASS`、failed `0`、skipped `0`、exit `0`。
- 涵蓋 capability hash/name resolution、internal-case visibility、buyer reply、first-response SLA、support least privilege、checkout replay、refresh idempotency、PayUni exact allowlist、Cloudflare rate-limit status與安全 cookie boundary。
- Fresh Prisma Client generation：在排除 `.env*` 的 no-env mirror、synthetic allowlist child environment 執行，exit `0`，`inheritedApplicationEnvironment=false`。
- TypeScript：`npx tsc --noEmit --pretty false`，exit `0`。
- Scoped ESLint：production source、tests 與 disposable runner，`--max-warnings 0`，exit `0`。
- Scoped `git diff --check`：exit `0`；只有 Git LF/CRLF notices，沒有 whitespace error。
- Controlled production build：exit `0`、signal `null`、`failureCategory=NOT_APPLICABLE`、`inheritedApplicationEnvironment=false`。只使用 `config/build-env.controlled.json` 的 key-name allowlist與 synthetic values；未輸出任何值，也未執行 provider／DB／deployment side effect。

## Disposable PostgreSQL evidence

- Receipt：`.ai-team/reports/g7-09c-buyer-support-disposable-20260808.json`
- SHA-256：`21db09875c02d7f3eb6e0ec180d14a9113bc3cc13f343b9c76efddc2439c626e`
- PostgreSQL `16-alpine`、loopback random port、tmpfs、synthetic fixtures、40 canonical migrations。
- Final：validate／deploy／status／constraints 全部 `PASS`；10 assertions；container cleanup `PASS`；temp root cleanup `PASS`。
- Assertions 包含 exact order tenant grant、token/cookie format、case creator XOR、response due、buyer actor XOR/audience、case creator exact tenant/order、event buyer actor exact case order與 rotation CAS one-winner。
- 一次較早的 final-schema run 在 migration 前的 schema marker write 失敗；該次沒有進 validate/deploy/assertion，container 與 temp cleanup 都 `PASS`。Runner 後續加入 bounded marker readiness retry，再以不同命令路徑取得上述 final PASS；沒有弱化任何 constraint。

## Browser evidence 的真實範圍

- 在 final reviewer remediation 前的同一 G7-09C source line，使用 in-app Browser 對 local production server `127.0.0.1` 執行無 capability 狀態的 desktop 與 `390×844` mobile 檢查。
- 已觀察：H1／安全空狀態／一般客服連結、desktop/mobile 無 horizontal overflow、頁面導航到 `/support`、console 無 warning/error。
- 未證明：keyboard Tab traversal；當次 Browser API 沒有把 focus 從 body 移出，因此不得標為 PASS。
- 未執行：具有真實 capability／登入客服帳號的完整 Browser E2E。Domain/action/disposable DB tests 證明資料與授權邏輯，但不能冒充完整瀏覽器旅程。Final controlled build 已覆蓋 reviewer remediation 後的 source compilation。

## 三輪 review 與修復

1. 第一輪：無 P0；發現 mutation 後 token rotation 造成 response-loss lockout，以及 checkout refresh 會更換 idempotency key的兩個 P1。兩項均修正。
2. 第二輪：前述 P1 關閉；另發現任意 HTTPS checkout destination P1，以及 event buyer actor 未 DB-level exact-order 綁定 P2。兩項均修正。
3. 第三輪：確認 exact PayUni／same-origin allowlist、`pagehide` 清除時機、grant composite FK 與 event→case exact-order FK；final verdict `NO_P0_P1`。

## 功能分數與 canonical 邊界

固定功能 `退款／客服` 由 G7-09B 的 `6.8/10` 調整為 local-evidence candidate `8.0/10`：

| 維度 | 分數 | 理由 |
| --- | ---: | --- |
| 核心能力 | 2.8/3 | merchant queue、buyer intake/reply、refund handoff、SLA 已閉環；跨裝置 recovery 尚未完成 |
| 錯誤復原 | 1.5/2 | revision／dedup／response-loss／refresh recovery 已有；仍無 Email magic-link recovery |
| UX | 1.3/2 | pending、status/error、masked context、mobile safe state；完整 capability Browser matrix 未執行 |
| 完整性與安全 | 1.0/1 | least privilege、CSRF、rate limit、PII envelope、exact tenant/order DB constraints |
| Fresh evidence | 1.4/2 | tests、DB、build、三輪 reviewer 足夠；authenticated Browser、staging與真人 SLA acceptance 尚缺 |
| **合計** | **8.0/10** | 達 fixed inventory 的 local 功能門檻，不是 Production acceptance |

Canonical CAT01～CAT10 維持 `73.5`、`canonical_delta=0`；CAT04 維持 `6.0`、CAT10 維持 `4.5`。這個 WP 改善了真實功能，但不能代替 PayUni Sandbox／staging、真人 support-SLA owner、退款／隱私／條款法律 review、finance／release 簽核與 external monitoring delivery evidence。

目前不需要使用者立即手動處理本地產品修復。上述真人／外部項目保留明確 `PENDING`，先跳過並繼續下一個可自動推進的功能 WP。

## Ownership、回滾與下一步

- 所有變更均留在既有 dirty worktree；沒有 stage、commit、push、merge、reset、clean、stash、restore、checkout、rebase 或 Production deploy。
- 回滾範圍只限 source manifest 中的 G7-09C 檔案、migration、runner、receipt與本 evidence。Migration 尚未套用到 Production；沒有正式資料或外部付款退款需要回滾。
- 下一個最高產品價值工作：`G7-10 — 商品管理販售閉環`。重新對帳 product create/edit、媒體整合、fulfillment type、庫存、draft/active、預覽、loading/error recovery 與訂單連結；這是 provisional fixed inventory 中仍沒有 fresh `>=7` 結論的主要產品項目。

## Integrity

- Source manifest：`docs/ai-team/evidence/g7-09c-buyer-support-sla-source-manifest-20260808.txt`
- Source manifest SHA-256：`a3fe4eb693ed36c594559c7eaf59e190a31d8b28b6d61254a1168c1c82271c44`
- Manifest paths：`39`；建立時 mismatch count：`0`。
- Receipt hash 與 manifest hash 只證明本機 checkpoint 內容；未宣稱不可變遠端簽章或 Production release approval。
