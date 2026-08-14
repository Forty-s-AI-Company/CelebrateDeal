# G7-13B 表單 Email ownership verification evidence

- Work Package：`G7-13B`
- 執行模式：`PRELAUNCH_DEV_AUTONOMOUS`
- UTC evidence time：`2026-08-08T18:30:39.473Z`
- 結果：`LOCAL_ACCEPTED`
- Browser／staging／Production：`NOT_RUN`

## 產品結果

1. 新報名先以 `UNVERIFIED` 保存，完成 HMAC 簽章 Email 驗證後才轉成 `VERIFIED`。
2. 驗證採 48 小時 expiry、submission/version 綁定、timing-safe signature comparison、Serializable transaction 與條件 claim，重放不會重複建立可信事件。
3. GET 只顯示確認頁，實際 mutation 必須由同源 POST 觸發，避免 Email scanner 自動完成驗證。
4. raw token 只存在加密 Email delivery envelope，不進 searchable column、analytics、監控 context 或公開 response。
5. 未驗證 submission 不進 dashboard、直播分析、團隊漏斗或可信 `lead_submit` KPI；商家名單仍顯示待驗證狀態，方便營運追蹤。
6. 聯盟 click 只有在 server 驗證 exact vendor、click、visitor 與 TTL 的 cookie 分支才會綁定。query／legacy referral 不會誤用瀏覽器殘留 click。
7. 一個 server-validated click 可對應多份不同表單，不會因一對一 unique constraint 造成第二份報名 500。
8. 既有 submission migration 後誠實標為 `UNVERIFIED`，沒有猜測歷史 Email ownership。

## 驗證結果

| 驗證 | 結果 | 範圍 |
|---|---:|---|
| Targeted deterministic tests | `93/93 PASS` | 15 test files |
| Disposable PostgreSQL | `PASS` | PostgreSQL 16 tmpfs、dynamic loopback port、44 migrations |
| Disposable DB contracts | `4/4 PASS` | verify-once、tamper/expiry、legacy default、concurrent idempotency、one-click-many-forms |
| Disposable cleanup | `PASS` | exact-container name inspection and removal |
| TypeScript | `PASS` | `npx tsc --noEmit --pretty false` |
| Scoped ESLint | `PASS` | G7-13B production/test/config files |
| Prisma validate／generate | `PASS` | dedicated no-dotenv config |
| Controlled production build | `PASS` | no inherited application environment |
| Read-only review | `NO_P0_P1_FINAL` | token、tenant、PII、KPI、migration、Email、race、final attribution delta |

## 真實 DB assertions

- 同一 token 第一次回傳 `verified`，第二次只回傳 `already_verified`。
- 只建立一筆 `VERIFIED_FORM_SUBMISSION` analytics event；visitor ID 為 submission ID 的 SHA-256，不含 Email。
- affiliate click 的 `convertedAt` 只由已驗證 submission 推進。
- 過期或竄改 token 不更新 submission、不新增 analytics。
- raw legacy insert 自動得到 `UNVERIFIED` 與 version `1`，不進 verified count。
- 兩個 concurrent 等價 POST 只保留一筆 submission，兩個 response 都使用不洩漏 enumeration 的 generic response。
- 同一 validated click 可成功綁定兩份 submission。

## 已知失敗與修復

- 第一次 disposable run 的 44 migrations 成功，但 DB test 被 `local-database-safety` 拒絕，原因是 database name 未符合既有 isolated allowlist。該 container 已精確清除。後續改用 allowlisted `celebratedeal_test`，沒有重複原失敗命令，結果為 44 migrations + 4/4 tests + cleanup PASS。
- reviewer 的初次 fork 看見舊的一對一 affiliate click schema；主流程已改成一對多並重跑 Prisma、DB、tests、typecheck、lint 與 build。

## 外部 blocker 與計分

- production distributed rate limit 仍需 Cloudflare WAF 或其他正式 provider 的外部設定證據。本機 memory limiter 不可冒充多 instance 防護。
- 本 WP 沒有執行 PayUni Sandbox、staging 或真人簽核，因此 canonical 維持 `73.5`、`CAT04=6.0`、`CAT10=4.5`。
- Goal 維持 `ACTIVE`。本地 SHA-256 可偵測後續變更，但沒有外部簽章，因此不宣稱為第三方不可否認證據。

## Ownership、回滾與下一步

- 工作區原本已有大量使用者與舊 WP 變更；本 WP 只接管 source manifest 所列 G7-13B 檔案與 hunks，不 stage、不 commit、不 push。
- source 回滾可移除 verification route/page/token/domain、verified-only KPI filters 與 Email trigger。migration 尚未部署 Production；若未來已部署，禁止破壞性 down migration，應以 forward migration 處理。
- 下一個最高產品價值工作：`G7-14` public checkout 的 server-issued buyer／reservation nonce，避免 client request 直接建立可占庫存的 provisional order。

完整 source SHA-256 見 `g7-13b-source-manifest-20260809.txt`。
