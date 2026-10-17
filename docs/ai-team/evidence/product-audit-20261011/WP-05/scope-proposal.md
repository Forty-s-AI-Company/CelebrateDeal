# WP-05：原生表單錯誤保留欄位的 scope 提案

狀態：APPROVED / IN_PROGRESS。2026-10-12 使用者在範圍說明後答覆「可以」，核准本提案之加密短效草稿與 additive migration。下方保留原提案依據；不解鎖其他 WP 或 Production。

## 為何原 scope 不足

原生 POST 必須 303 返回原頁，且不能將 PII 放 query/log。既有模型没有通用短效表單草稿，不能把無效／被拒資料混入正式 FormSubmission。合法 payload 可達數十 KB，單 cookie／多 cookie 會超出常見 header 上限；記憶體 Map 無法跨 instance/restart 保證返回時可讀。把全部表單改成 AJAX 也不能滿足 no-JS 原生契約。

## 請求的精確擴充

本次待核准項是新增短效草稿 table 與 additive migration；下游元件 props 串接以逐檔 ownership 記錄，不授權其他 schema。

草案欄位：`idHash String @id`、`encryptedPayload String`、`sourcePath String`、`formId String`、`createdAt DateTime @default(now())`、`expiresAt DateTime`，expiresAt index。TTL、刪除策略與無 storage 時的保留能力必須在實作／獨立 review 前驗證，不把安全降級當成欄位保留成功。

- `prisma/schema.prisma`：新增獨立 `RegistrationFormRetryDraft`，僅 opaque lookup hash、密文、來源 path/form binding、建立與到期時間；不改既有 table、關聯或正式 submission 語意。
- `prisma/migrations/20261011_registration_form_retry_draft/migration.sql`：additive create table/index；只在新建 disposable DB 驗證。不碰目前任何既有 DB，包括本 Goal 的測試 DB；另建隔離 DB 作 migration 測試。
- `src/lib/registration-form-retry.ts` 與 targeted tests：短效受限存取、purpose-separated 既有加密機制、來源/form 綁定、大小上限、過期清理與 fail-closed 行為。缺核准 runtime key 時不得退回明文。
- `src/components/registration-submission-form.tsx` 與 tests：共同提交狀態、欄位回填、aria-live/alert；保留各頁成功行為與 Email 驗證規則。
- 原 WP-05 route／三個 renderer，及 `src/lib/registration-form-fields.ts`（保留 return path 欄位）。
- 公開入口 `src/app/lp/[slug]/page.tsx`、`src/app/lp/[slug]/[stepPath]/page.tsx`、`src/app/form/[slug]/page.tsx`、`src/app/p/[slug]/page.tsx`：只向匹配的原頁/form 回傳草稿欄位，不回傳 capability。
- 若需要新增清理排程或外部服務，另列 scope；本提案不授權 scheduler／Production。

## 安全與驗收條件

- 403 跨源拒絕不信任惡意 return path、不保存其欄位；只有可驗證同源 native 請求才保留草稿。無可信來源使用固定安全錯誤頁，不能承諾回到未提供的原頁。這是輸入安全邊界，需在正式驗收契約列明。
- 草稿識別值使用加密隨機值、HTTP-only same-site cookie、短效 TTL；DB 僅存 hash。測試不得輸出 cookie、PII 或密文。
- 400/403/404/429/503：native 303 + 原頁訊息 + 合法欄位回填；JSON API 保持既有 status/body 契約；503 後重送不新增重複 submission。
- 含最大合法 payload、跨表單／來源／租戶、不合法 redirect、過期、竄改、無 key/storage 失效、JS/no-JS、a11y。確認不將草稿內容送到 logging/analytics。
- 保持 CSRF／Origin／rate-limit 檢查，不藉錯誤處理降低防護；不改 Email 確認資格。
- 所有資料合成。唯一 writer=主代理。涉及 Migration，重路由並要求獨立深度審查；不預選實作模型。

## 回滾與邊界

回滾限本 WP 精確 patch；測試資源保留 evidence 後只處理自行建立且確認 identity 的 disposable DB。不對正式 DB 做 down migration，不推送或部署。

依 Goal Plan 停止條件第 4 點，schema/migration 擴充未核准前不寫入 schema 或執行 migration。其餘 WP 可繼續。
