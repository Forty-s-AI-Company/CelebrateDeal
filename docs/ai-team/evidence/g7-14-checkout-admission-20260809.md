# G7-14 公開結帳 admission 與安全重試 evidence

- Work Package：`G7-14`
- 執行模式：`PRELAUNCH_DEV_AUTONOMOUS`
- UTC evidence time：`2026-08-08T19:11:36.764Z`
- 結果：`LOCAL_ACCEPTED`
- staging／PayUni Sandbox／Production：`NOT_RUN`

## 產品結果

1. 公開結帳不能再只靠瀏覽器自行產生的 idempotency key 直接占用庫存。瀏覽器必須先向 `POST /api/payments/checkout/admission` 取得伺服器簽發的 admission 與 UUID。
2. admission 以 HMAC 綁定 vendor、product、product revision、idempotency key、30 分鐘 expiry，以及 HttpOnly checkout session cookie 的 SHA-256；竄改、跨商品、跨商家、跨 session、過期或錯誤 key 均 fail closed。
3. session cookie 採 `HttpOnly`、`SameSite=Strict`、限定 `/api/payments/checkout` path，並由 production／HTTPS 條件決定 Secure。
4. 商品 revision 在 admission 後變更時，新 checkout 回 409，避免使用過期價格／庫存快照。
5. 同一 admission 的併發請求只會留下 1 筆 PaymentTransaction、1 筆 CommerceOrder、1 筆 InventoryReservation，庫存只扣 1 次；DB unique constraint 與 Serializable transaction 是 durable race barrier。
6. response 中斷、5xx、buyer-support grant 暫時失敗、canonical order 或 provider metadata 尚未可見時，前端保留同一 admission／idempotency key。可安全重試狀態回 425；只有明確 409 才重新取得 admission，避免 ambiguity 造成第二次占庫存。
7. 結帳 UI 在取得 admission 前顯示誠實 pending 訊息，送出期間保持 disabled、loader、`aria-busy` 與 live status。

## 驗證結果

| 驗證 | 結果 | 範圍 |
|---|---:|---|
| Targeted deterministic tests | `54/54 PASS` | 6 files；admission、route、retry、PII、attribution、component contract |
| Disposable PostgreSQL | `PASS` | PostgreSQL 16 tmpfs、dynamic loopback、44 migrations |
| Disposable DB contracts | `8/8 PASS` | admission-bound idempotency、same-key concurrency、final-unit race、commit/release/refund/expiry |
| Production build | `PASS` | hermetic mirror，未繼承 application environment |
| Browser | `3/3 PASS` | Chromium public checkout、merchant order desktop/mobile |
| Accessibility／RWD | `PASS` | Axe serious/critical=0、mobile overflow=0、keyboard focus |
| Tenant／PII | `PASS` | tenant isolation、encrypted envelope 不出現在 HTML |
| TypeScript／scoped ESLint | `PASS` | final G7-14 source/test/config scope |
| Read-only final review | `NO_P0_P1_FINAL` | admission、cookie、race、425/5xx retry、buyer-support 503 |
| Cleanup | `PASS` | server、exact-label container、tmpfs、temp mirror 均清除 |

## Reviewer 發現與修復

- 初次審查發現 buyer-support grant 在 transaction 已成立後回 503，前端原本會丟棄 key。已改為 5xx 保留同一 admission，並證明第二次只 replay 原 checkout，reservation 與 provider session 都沒有再次建立。
- 第二次審查發現 `Checkout already in progress` 使用 409 會丟 key。已改成 425 並補 UX／retention contract。
- 第三次審查發現 `primaryCommerceOrder=null` 先被 identity mismatch 判 409，導致 425 分支不可達。已調整比對順序並補 null-order 專測。
- 最終 reviewer 結果為 `NO_P0_P1_FINAL`。

## Evidence lineage

- Disposable DB receipt：`.ai-team/reports/g7-14-checkout-admission-disposable-20260809.json`
- Final Browser receipt：`docs/ai-team/evidence/g7-04-browser-qa-4b0cc7184d9e6dea.json`
- Browser screenshots：`docs/ai-team/evidence/g7-04-browser-qa-4b0cc7184d9e6dea-screenshots/`
- G7-04 commerce Browser harness 本輪擴充為 3 個案例並以最終 source 建立全新 mirror；receipt 的歷史 schema／WP 名稱仍為 G7-04，因此本文件只引用其實際 current-source Browser 與 build 結果，不改寫 receipt provenance。

## 外部限制與計分

- 這個 admission 可阻擋沒有伺服器簽章與 session binding 的直接 checkout，也能把同 admission 重試收斂到同一 DB idempotency key。它不宣稱能阻止會先呼叫 admission endpoint 的分散式 bot；production Cloudflare WAF／distributed rate limit／bot management 仍需外部設定與證據。
- 沒有執行 PayUni Sandbox、staging、Production 或真人簽核。canonical 維持 `73.5`、`CAT04=6.0`、`CAT10=4.5`，不因本機功能修正直接加分。
- Goal 維持 `ACTIVE`。本地 SHA-256 可偵測後續變更，但沒有第三方簽章，不宣稱為外部不可否認證據。

## Ownership、回滾與下一步

- 工作區原本已有大量使用者與舊 WP 變更；本 WP 只接管 source manifest 所列 G7-14 files／hunks，不 stage、不 commit、不 push。
- 本 WP 沒有新 migration。回滾範圍為 admission module／route、checkout request contract、form retry behavior 與對應 tests／QA harness；不得回滾其他既有 checkout、CommerceOrder、PII 或 inventory changes。
- 依使用者要求，本 checkpoint 完成後停下。下一次恢復時，先依固定可販售功能 inventory 重算，再挑仍低於 7/10 的最高產品價值項目；外部或真人 blocker 先列待辦後跳過。

完整 source SHA-256 見 `g7-14-source-manifest-20260809.txt`，artifact SHA-256 見 `g7-14-artifact-digests-20260809.txt`。
