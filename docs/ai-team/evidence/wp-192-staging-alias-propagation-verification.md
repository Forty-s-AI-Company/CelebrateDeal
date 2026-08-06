# WP-192 — Staging alias propagation verification

## 結果

唯一 bounded read-only live execution 回傳 `WP192_COMPLETE_CANDIDATE`。WP-191 復原後的 staging alias 已完成最新版內容身分驗證：routing、direct marker、alias marker 與 login marker 全部相符。

這份證據只支持 staging rollback／forward-restore rehearsal，不代表 Production deployment、Production rollback 或正式營運授權已完成。

## Fresh identity evidence

- Project：`celebrate-deal-staging`
- Scope：`a25814740s-projects`
- Target：`preview`
- Deployment state：`READY`
- Alias deployment identity：精確匹配 `dpl_E3g7ZjYLMd8JDsPybA2Hxz4bKE6W`
- WP-187 source digest：精確匹配 `cfa1b2d8841957dd071e9945a1770d01bff09081210f2fbdc820669edf339f34`
- Direct latest marker：HTTP 200、`workPackage`與`sourceDigest`均匹配
- Alias marker：第一筆HTTP 200、`workPackage`與`sourceDigest`均匹配
- Alias login：HTTP 200、固定登入頁marker匹配
- Redirect未被當成成功

## Attempt budget 與 side effects

| 操作 | 實際次數 | 上限 |
|---|---:|---:|
| Alias inspect | 1 | 1 |
| Direct marker GET | 1 | 1 |
| Alias marker GET | 1 | 2 |
| Alias login GET | 1 | 1 |
| Alias mutation | 0 | 0 |
| Deployment mutation | 0 | 0 |
| Environment mutation | 0 | 0 |
| `/api/health` | 0 | 0 |
| Database operation | 0 | 0 |
| PayUni operation | 0 | 0 |
| Production／DNS／Git mutation | 0 | 0 |

Runner 未讀取`.env*`、secret、token或cookie。CLI raw output、raw marker JSON、raw HTML、headers、cookies與完整URL只在記憶體內處理後丟棄，沒有保存至receipt或文件。

## Deterministic evidence

- Runner contract tests：8 passed／0 failed／0 skipped
- Scoped ESLint：PASS，0 warnings
- TypeScript `tsc --noEmit`：PASS
- Strict sanitized receipt readback：PASS
- Strict text scan：PASS
- `git diff --check`：PASS
- Staged index：empty
- Ownership：既有dirty全部`PRESERVE_ONLY`，`UNKNOWN=0`、`MIXED_HUNKS=0`

## Score candidate

- CAT09：`7.0 → candidate 7.5`
- Canonical total：`72.5 → candidate 73.0`
- Staging rollback Gate：`PARTIAL_OPEN → candidate CLOSED_FOR_STAGING`
- Receipt內`applied=false`；只有Sol High `ACCEPT`後才可更新canonical scorecard。

## Artifacts

- `scripts/qa/wp192-staging-alias-propagation-verification.mjs`
- `scripts/qa/wp192-staging-alias-propagation-verification.test.mjs`
- `.ai-team/reports/wp192-staging-alias-propagation-verification.json`
- `.ai-team/reports/wp192-agy-fast-qa.json`

## Rollback

遠端操作全部唯讀，沒有遠端rollback。若本包未被接受，只需保留或移除WP-192新增的runner、tests、receipt與evidence；不得碰觸WP-191或任何既有dirty產品檔。
