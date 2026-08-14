# G7-38 全站導覽登出回饋證據

- Work Package：`G7-38`
- 驗證時間：`2026-08-09T10:34:09.5969326Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Source aggregate SHA-256：`ea4a623fa6c541993a47c61378a730a9adcfec60b11db161728cb6fab705c3c8`
- 結論：`LOCAL_FUNCTION_AND_REVIEW_PASS`

## 產品問題與修正

全站 `AppShell` 同時渲染桌面與行動版導覽，兩個 logout form 原本都使用 raw submit button。撤銷 session、清除 cookie 與 redirect 期間，使用者看不到 loading，也能重複送出。

兩個入口現在都接入 `FormSubmitButton`，提供：

- `登出中…` 與可見 spinner。
- pending `disabled`、`aria-disabled`、`aria-busy`。
- `role="status"`／`aria-live="polite"` 的「正在撤銷目前 session 並登出」訊息。
- 每個 responsive form 各自擁有 `useFormStatus` scope；desktop pending 不會誤標 mobile，反向也相同。

Logout Server Action 沒有修改，仍依序執行 CSRF 驗證、`revokeCurrentSession()`、刪除 `AUTH_COOKIE`／`LEGACY_VENDOR_COOKIE`，最後 redirect 到 `/login`。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| AppShell／submit component tests | PASS | 2 files，21 tests passed，0 failed，0 skipped |
| Responsive form scope | PASS | desktop pending／mobile idle 與 desktop idle／mobile pending 兩種矩陣皆通過；每次只有一個 spinner、busy、live status、disabled |
| Existing shell behavior | PASS | role navigation、skip link、桌面／行動 nav labels、兩個 CSRF fields、公開政策與客服連結 assertions 保持通過 |
| Targeted ESLint | PASS | 2 files，exit code 0，無輸出 |
| Full TypeScript typecheck | PASS | `tsc --noEmit`，exit code 0 |
| React checklist | PASS | 未新增 effect、fetch、waterfall 或 dependency；Server Component 只接入既有 client submit control；兩個 form 狀態互不共用 |
| Independent reviewer | RESOLVED | 唯讀核對兩個 form scope、pending semantics、role navigation、兩個 CSRF fields 與 logout action 順序；未發現 P0／P1／P2 |

## 執行命令

```text
node node_modules/vitest/vitest.mjs run src/components/app-shell.test.ts src/components/form-submit-button.test.tsx
npx eslint src/components/app-shell.tsx src/components/app-shell.test.ts
npm run typecheck
```

三段命令皆為 exit code `0`。本 WP 未啟動 Browser、DB、staging、Sandbox、付款、退款、Email、Production session 或任何外部操作；未執行項目不列為 PASS。

## Source SHA-256

下列 manifest 依原順序、UTF-8、LF 結尾後計算 aggregate SHA-256。

```text
6be1542f8cddc807d4dc65e502dcf430142b9edade52e3c820860b3628d416f2  src/components/app-shell.tsx
c99ed57aa97ddd84482263dbe9472b88a6893919685b61189df340b98cb80e6d  src/components/app-shell.test.ts
baa09e70a3e72c935c405bc451bf7462e1ed1dd4827c7d7af3fa73fd4b5bf3cd  src/components/form-submit-button.tsx
c4e9e70304a1857f2f2d1067b4de4523653d79a788c0dee5ad72b91af5c2c9c8  src/components/form-submit-button.test.tsx
12726b14863edd0cb1bc33e338cb22e22b7138f9899ef1c61e68a959ca905022  src/app/actions/auth-security-actions.ts
```

## Ownership、安全與回滾

- `src/components/app-shell.tsx` 與 `src/components/app-shell.test.ts` 在本 WP 前已有使用者／其他 WP 的導覽、角色權限與公開連結變更；本次只疊加 logout submit wiring 與 responsive pending tests。
- Auth action、CSRF、session、cookie、redirect、role navigation 與 route inventory 沒有修改。
- 沒有讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 沒有觸發任何 session 撤銷、cookie mutation 或 Production 操作。
- 沒有降低 assertion／coverage threshold、增加 skip／exclude 或縮減 inventory。
- 回滾只需把兩個 `FormSubmitButton` 還原成原先按鈕並移除兩個 pending scope cases；不涉及 schema、migration、資料或外部狀態。

## 分數資格

- `merchant_onboarding_settings` 候選可由 `8.3 → 8.4`，UX `1.8 → 1.9`。
- canonical 維持 `74.0`；本機 UI tests 不代替 CAT04 Sandbox 或 CAT10 真人／外部證據。

## 尚未完成

- CAT04／CAT10 blocker 未改變，且不阻擋下一個本機產品工作。
