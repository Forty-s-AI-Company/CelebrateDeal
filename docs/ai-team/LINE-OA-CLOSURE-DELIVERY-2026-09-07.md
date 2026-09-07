# LINE OA 通知閉環交付報告（2026-09-07）

## 結果

- 前台報名成功、Email 驗證完成與付款結果頁皆提供「🟢 接收 LINE 開播提醒與電子票券」。
- LINE Login 使用 PKCE、單次 state、nonce 驗證與 `bot_prompt=aggressive`；身份與 profile 欄位加密保存。
- 新建報名會取得 30 分鐘、HttpOnly、SameSite=Lax、用途隔離的 signed LINE binding capability；duplicate／並行衝突不簽發，避免既有報名遭劫持。
- 新增受 `Authorization: Bearer CRON_SECRET` 保護的 `/api/cron/line-notifications`，並在 `vercel.json` 宣告每分鐘排程。
- Delivery worker 使用租約回收、原子 claim、`vendorId + deliveryId` 限定與 LINE retry key；409 已接受回應收斂為 `sent`，永久 4xx 終止重試。
- 直播從 `scheduled` 進入 `live` 後，以每場次／學員／startedAt 的 stable idempotency key 建立 outbox 並立即限定範圍派發；Cron 可接手失敗項目。
- LINE 管理中心提供租戶專屬 Webhook URL、複製與設定指引、owner-only 連線測試，以及最近 20 筆租戶限定推播紀錄。

## 安全證據

- 憑證只在 Server Action／worker 內解密；前端、回應與 audit metadata 不含 access token、channel secret 或 LINE userId。
- `LineDelivery` 既有 schema 保留 `[vendorId, idempotencyKey]` 唯一約束與 account／identity 的租戶複合外鍵。
- 高階唯讀安全審查找到並修正 duplicate registration capability 劫持；修正後結論為沒有尚未處理的高風險跨租戶、OAuth、Cron 授權或重複推播缺陷。

## 最終驗證

| 命令 | 結果 |
| --- | --- |
| `npm run test:interactions` | PASS，167／167 tests |
| `npm run test:contracts` | Linux CI PASS；Windows 本機 966／969，3 項為實體 SHA／CRLF evidence 差異，未將其誤列為 PASS |
| `npm run typecheck:strict-index` | PASS |
| `npm run typecheck` | PASS |
| `npm run secret:scan` | PASS，`secret_scan_passed` |
| LINE feature tests | PASS，51／51 tests；actions 322／322 tests |
| Targeted ESLint | PASS，0 errors／0 warnings |
| `git diff --check` | PASS（僅工作樹 CRLF 提示，無 whitespace error） |

## 上線邊界

- `vercel.json` 已具備每分鐘 Cron 宣告；部署後 Vercel 會以 `CRON_SECRET` Bearer 呼叫端點。
- 本輪沒有 Production deployment、正式 LINE push 或正式客戶資料操作。
- 受保護 `secure-staging-validation.yml` 已加入固定 `line-notifications-e2e` task；僅允許受保護 `master`、固定 Preview lineage、固定 outbound allowlist、固定副作用預算與 canonical sanitized receipt。
- 功能主體已由 PR #203 合併（`aeb128e9d64c80a69170a036da58566e8644b066`）。後續 runner／receipt fail-closed 強化由 PR #204～#208 合併；PR #208 的兩條完整 quality pipeline 與兩個 Vercel Preview 均 PASS，合併 SHA 為 `354a1560aa48c67c8b941ea86d804841914581f2`。
- 2026-09-07 受保護 staging run `34084016753` 已通過 checkout、locked dependencies、Prisma、runner contract 與 exact Preview dispatch identity；固定 LINE task在任何 LINE／DB 測試前 fail closed，sanitized annotation 為 `stage=require_database_binding`、`reason=RECEIPT_FILE_MISSING`。
- 上述證據代表 GitHub Environment 的隔離綁定 `LINE_STAGING_DATABASE_URL` 缺少或為空。安全政策禁止 agent 讀取、建立或以較廣域的 `STAGING_DATABASE_URL` 代替；需由 Environment owner 補上後，重跑同一固定 task 才能完成真實 staging LINE push 驗收。
- Production deployment、Production Cron 啟用與正式 LINE push 尚未獲獨立授權，因此本輪沒有執行，也不得宣稱已上線。

### Secure staging 驗收包（runner 已就緒，待 owner 補齊隔離 DB 綁定後執行）

- exact Preview SHA／project／Ready lineage gate。
- Preview 必須設定 `LINE_STAGING_VALIDATION_ENABLED=true`；在任何有效 Cron 前，先以一次性 DB sentinel HMAC proof 證明 Preview runtime 與 runner 連到同一個隔離 staging DB。
- Protected Environment 的 `LINE_STAGING_DATABASE_IDENTITY_SHA256` 綁定 hostname、port、database、username 與 `public` schema；同 host 不同 project／role 無法冒充 staging。
- 專用 staging DB、專用 LINE 測試 OA 與單一測試收件人。
- 錯誤 Bearer 必須回 401 且零 DB 副作用。
- 正確 Bearer 僅產生一筆 `live_started` delivery，狀態落為 `sent`。
- 第二次 Cron 必須維持同一 stable idempotency key，且不新增或重送。
- 副作用預算固定為一個 logical LINE push；任何超額立即 fail closed。
- 每次執行 fixture 只以精確 PK + `vendorId` 清理，清理不完整即判定失敗。
- artifact 只允許 canonical sanitized receipt，不得包含 token、LINE user ID、原始資料列、完整 URL 或 provider response。

## 回滾

- 移除 `vercel.json` 的 LINE cron 項目即可停止新排程，不刪除既有 outbox。
- 移除新增 route、binding session 與 live-start helper，並回退本報告列出的 LINE 專屬 hunks；不得回退或覆蓋工作樹中其他既有直播互動修改。
