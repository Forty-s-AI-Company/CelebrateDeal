# G7-39 團隊範本列級操作回饋證據

- Work Package：`G7-39`
- 驗證時間：`2026-08-09T10:52:33.224Z`
- 模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Source aggregate SHA-256：`03ec018edde589378a6df37236b82cceff804ac3d4fb0fd0b8f213cc6562d6be`
- 結論：`LOCAL_FUNCTION_AND_REVIEW_PASS`

## 產品問題與修正

團隊範本清單原本讓所有列共用同一個 `useActionState`。商家建立或停用任一範本的分享連結時，整張清單的分享按鈕會一起進入 pending，操作結果與分享網址也顯示在清單頂端，使用者無法確定結果屬於哪一列。

本次調整包含：

- 每個範本列各自持有 action state、pending、成功／失敗結果與複製狀態。
- 只有實際送出的列顯示 spinner、`disabled`、`aria-disabled`、`aria-busy` 與 live status。
- 分享建立／停用結果留在原列；錯誤使用 `role="alert"`，成功使用 `role="status"` 與 `aria-live="polite"`。
- 保留 `_csrf`、`teamId`、`pageId` 與 operation；停用分享仍需確認已發出的連結會失效。
- Clipboard API 不存在或拒絕時，顯示「複製失敗，重試」與可存取錯誤訊息，可手動複製或重試。
- 夥伴取得範本的建立按鈕接入共用 pending control，避免重複建立夥伴頁。
- Reviewer 發現共用確認按鈕會早於瀏覽器原生 required／pattern validation 顯示確認。現已先執行 `checkValidity()`；無效表單交由原生 validation 處理，不提前跳確認。

Server Actions、CSRF 驗證、團隊授權、資料模型、schema 與 migration 沒有修改。

## 驗證結果

| 驗證 | 結果 | 證據摘要 |
|---|---:|---|
| Components／pages tests | PASS | 5 files，28 tests passed，0 failed，0 skipped |
| 多列 pending scope | PASS | 兩列並存時只有 submitter 列出現 busy、spinner、pending label 與 live message |
| 列級結果歸屬 | PASS | 第一列成功與第二列失敗同時存在，分別保留 status／alert 與原列訊息 |
| Clipboard recovery | PASS | 相對 URL 依 current origin 複製；拒絕時顯示重試與 assertive message |
| Native form validation order | PASS | 無效 required form 不觸發 confirmation，保留瀏覽器原生阻擋 |
| Targeted ESLint | PASS | 6 files，exit code 0，無輸出 |
| Full TypeScript typecheck | PASS | `tsc --noEmit`，exit code 0 |
| Diff whitespace | PASS | exit code 0；只有 Git LF／CRLF working-copy warning，無 whitespace error |
| Independent reviewer | RESOLVED | 唯讀 reviewer 確認列級 state、React 19 form status、tenant identifiers 與安全無 finding；共用 validation-order low finding 修正後複核 resolved |

## 執行命令

```text
npm test -- src/components/team-template-list.test.tsx src/components/team-template-claim.test.tsx src/components/form-submit-button.test.tsx 'src/app/(app)/team-templates/page.test.tsx' 'src/app/team-template/page.test.tsx'
npx eslint src/components/team-template-list.tsx src/components/team-template-list.test.tsx src/components/team-template-claim.tsx src/components/team-template-claim.test.tsx src/components/form-submit-button.tsx src/components/form-submit-button.test.tsx
npm run typecheck
git diff --check -- src/components/team-template-list.tsx src/components/team-template-list.test.tsx src/components/team-template-claim.tsx src/components/team-template-claim.test.tsx src/components/form-submit-button.tsx src/components/form-submit-button.test.tsx
```

上述命令皆為 exit code `0`。本 WP 未啟動 Browser、DB、staging、Sandbox、付款、退款、Email、Production session 或外部操作；未執行項目不列為 PASS。

## Source SHA-256

下列檔案依原順序讀取為 UTF-8、將 CRLF 正規化為 LF；個別 SHA-256 取各檔內容，aggregate SHA-256 取正規化內容依序串接後計算。

```text
05b6861631d2134f907fb83d5998c6a96965bfdfe55cf294d1baceb384be66ab  src/components/team-template-list.tsx
fa693fb53577b8a05f5bfd9f1bfe5e49260dc5b314fcda0a66b10ee4f2390fce  src/components/team-template-list.test.tsx
57d2026346e48ec56053712b4dea74878107dacf9601bbaa2c7dee1c44e193e2  src/components/team-template-claim.tsx
a0193014bbb6dc8e62f2a3380af4ac2b3567d9f6e848a13e7b641dabcca66c6b  src/components/team-template-claim.test.tsx
bb3d6fa48022022dbea8c09c557ca7a3469b59784f18dea03ec3faab7e0b58e9  src/components/form-submit-button.tsx
559b4d140fbacdb4185864028b4a68bfce93dabbc0ddd9370002a6462e86b6d3  src/components/form-submit-button.test.tsx
```

## Ownership、安全與回滾

- 六個 source／test 檔在本 WP 開始前均無 scoped dirty status；scorecard 與其他既有 dirty worktree 變更保持原樣。
- 沒有讀取或輸出 `.env*`、Token、Cookie、Secret、正式客戶或付款資料。
- 沒有觸發分享 mutation、付款、退款、DB、Email、Production 或外部服務。
- 沒有降低 assertion／coverage threshold、增加 skip／exclude 或縮減 inventory。
- 回滾範圍僅為列級 share component、claim submit feedback、共用 confirm validation order 與對應測試；不涉及 schema、migration、資料或外部狀態。

## 分數資格

- `team_stream_operations` 候選可由 `8.8 → 8.9`，UX `1.7 → 1.8`。
- canonical 維持 `74.0`；本機 UI tests 不代替 CAT04 Sandbox 或 CAT10 真人／外部證據。

## 尚未完成

- CAT04／CAT10 blocker 未改變，且不阻擋下一個本機產品工作。
