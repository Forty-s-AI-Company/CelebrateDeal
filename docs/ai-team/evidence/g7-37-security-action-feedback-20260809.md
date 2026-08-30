# G7-37 安全設定非同步操作回饋證據

- Work Package：`G7-37`
- 驗證時間：`2026-08-09T10:26:32.6884848Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Source aggregate SHA-256：`cd1954d3b5aebc02d1ea06142b5da5772403a2a61e4d265aecc49723ed6339ae`
- 結論：`LOCAL_FUNCTION_AND_REVIEW_PASS`

## 產品問題與修正

`/settings/security` 原有三個高影響 Server Action 使用 raw submit button：

- 驗證 TOTP 後重新產生 recovery codes。
- 重新寄送商家成員設定密碼邀請。
- 寄送目前帳號的 password reset smoke test。

慢網路或寄信期間缺少可見 loading、disabled、防重送、spinner、`aria-busy` 與 live status。現在三個入口都接入共用 `FormSubmitButton`，並使用各自的 pending label／message。重新產生 recovery codes 會先明確告知舊 codes 立即失效並要求確認；`/mfa/setup` 的同一操作也套用相同確認。

redirect 回傳的成功訊息補上 `role="status"`、`aria-live="polite"`，錯誤訊息補上 `role="alert"`。Server Action、CSRF、auth／owner、MFA、rate limit、allowlist、audit、Email provider 與 redirect 邏輯沒有修改。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| Action／page tree／submit component tests | PASS | 2 files，221 tests passed，0 failed，0 skipped |
| Security page wiring | PASS | 三個 action 都接入 `FormSubmitButton`；page tree test 驗證 pending labels、recovery confirmation、status／alert 與 raw button inventory |
| Targeted ESLint | PASS | 3 files，exit code 0，無輸出 |
| Full TypeScript typecheck | PASS | `tsc --noEmit`，exit code 0 |
| Raw submit inventory | PASS | 兩個安全頁面沒有 raw `<button>`；`rg` 無匹配，預期 exit code 1 |
| React checklist | PASS | 未新增 effect、fetch、waterfall 或 dependency；Server Components 只接入既有 client submit control；每個 form 保有獨立 `useFormStatus` scope |
| Independent reviewer | RESOLVED | 唯讀檢查 action-scoped pending、兩個安全頁面、CSRF、auth／owner、MFA、rate limit、allowlist、audit 與測試；未發現 P0／P1／P2 |

## 執行命令

```text
node node_modules/vitest/vitest.mjs run src/components/form-submit-button.test.tsx src/app/actions.test.ts
npx eslint 'src/app/(app)/settings/security/page.tsx' 'src/app/mfa/setup/page.tsx' src/app/actions.test.ts
npm run typecheck
rg -n '<button' 'src/app/(app)/settings/security/page.tsx' 'src/app/mfa/setup/page.tsx'
```

前三段命令 exit code `0`。最後一段預期因零匹配回傳 exit code `1`。本 WP 未啟動 Browser、DB、staging、Sandbox、付款、退款、Email 寄送或 Production 操作；未執行項目不列為 PASS。

## Source SHA-256

下列 manifest 依原順序、UTF-8、LF 結尾後計算 aggregate SHA-256。

```text
c9d40de5fb56b36a25767bf154a119fbb634c5177a91270a8bd45746a8a27f2e  src/app/(app)/settings/security/page.tsx
5073f7c30716663e563668bcb305eac7a239d69aab58cc3351892d409176f60d  src/app/mfa/setup/page.tsx
dbcd98e83f6b9a9bc66602a705703db075e39a5ac7cbd0d234359bae9efc6762  src/app/actions.test.ts
baa09e70a3e72c935c405bc451bf7462e1ed1dd4827c7d7af3fa73fd4b5bf3cd  src/components/form-submit-button.tsx
c4e9e70304a1857f2f2d1067b4de4523653d79a788c0dee5ad72b91af5c2c9c8  src/components/form-submit-button.test.tsx
```

## Ownership、安全與回滾

- `src/app/(app)/settings/security/page.tsx` 與 `src/app/actions.test.ts` 在本 WP 前已有使用者／其他 WP 變更；本次只疊加 submit wiring、訊息語意與一個 page tree test，未覆蓋既有 ownership。
- `src/app/mfa/setup/page.tsx` 本次只加入 recovery regeneration confirmation。
- 沒有讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 沒有觸發 Email、session mutation、recovery code regeneration 或任何外部服務。
- 沒有降低 assertion／coverage threshold、增加 skip／exclude 或縮減 inventory。
- 回滾只需移除 G7-37 的三個 submit wiring、兩個頁面的 recovery confirm、status／alert 屬性與 page tree assertions；不涉及 schema、migration、資料或外部狀態。

## 分數資格

- `merchant_onboarding_settings` 候選可由 `8.2 → 8.3`，UX `1.7 → 1.8`。
- canonical 維持 `74.0`；本機 UI／action tests 不代替 CAT04 Sandbox 或 CAT10 真人／外部證據。

## 尚未完成

- CAT04／CAT10 blocker 未改變，且不阻擋下一個本機產品工作。
