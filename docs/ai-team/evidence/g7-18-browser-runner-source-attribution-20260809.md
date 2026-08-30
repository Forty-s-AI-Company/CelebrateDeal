# G7-18 Browser runner source attribution 與 cleanup ownership

- 結果：`RUNNER_CONTRACTS_PASS_COVERAGE_GATE_FAIL`
- 執行模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Goal：`ACTIVE`
- Evidence UTC：`2026-08-08T21:15:58.806Z`

## 本輪完成

- 將 G7-04 commerce 與 G7-05 form-builder Browser runner 的 failure classification、diagnostic sanitization、mirror exclusion、合成環境、container inspection 與精確暫存目錄清理拆成可直接測試的純函式邊界。
- G7-05 disposable PostgreSQL cleanup 新增 exact container ID、name、run-id label、marker label、tmpfs mount、database comment 與 schema comment ownership gate。任一欄位不吻合時保存 `CLEANUP_BLOCKED`，不執行 `docker rm -f`。
- G7-04 既有精確 cleanup 保持不變，新增測試確認錯誤 marker 無法刪除暫存 mirror。
- 新增 14 個 Node TAP contracts，兩個 runner 合計由 9 個增加至 23 個；沒有新增 skip、exclude，沒有降低 assertion 或 coverage threshold。

## 驗證結果

| 驗證 | 命令 | exit code | 結果 |
|---|---|---:|---|
| Targeted runner contracts | `node --test scripts/g7-commerce-browser-qa.test.mjs scripts/g7-form-builder-browser-qa.test.mjs` | 0 | 23/23 PASS |
| Scoped ESLint | `npx eslint scripts/g7-commerce-browser-qa.mjs scripts/g7-commerce-browser-qa.test.mjs scripts/g7-form-builder-browser-qa.mjs scripts/g7-form-builder-browser-qa.test.mjs` | 0 | PASS |
| TypeScript | `npm run typecheck` | 0 | PASS |
| Complete Node TAP | `npm run test:contracts` | 0 | 712/712 PASS |
| Combined coverage | `npm run test:coverage` | 1 | tests PASS，coverage gate FAIL |
| Vitest inside coverage | coverage runner child | 0 | 308/308 files、2,074/2,074 tests PASS |
| Disposable PostgreSQL cleanup | coverage runner finally | 0 | container PASS、tempRoot PASS |

本輪未執行實際 Browser、Bombmy、staging、PayUni Sandbox、Production、正式付款、退款、寄信或部署。Browser evidence 狀態維持 `NOT_RUN`，不冒充畫面驗收。

## Coverage truth

| Metric | G7-17 | current | 變化 | gate | 結果 |
|---|---:|---:|---:|---:|---|
| Statements | 43.87%（16,959／38,654） | 44.09%（17,055／38,678） | +0.22pp | 63% | FAIL |
| Branches | 48.51%（15,701／32,360） | 48.81%（15,814／32,398） | +0.30pp | 57% | FAIL |
| Functions | 52.52%（3,229／6,147） | 52.77%（3,247／6,153） | +0.25pp | 60% | FAIL |
| Lines | 61.74%（14,755／23,895） | 61.96%（14,818／23,912） | +0.22pp | 65% | FAIL |

完整 inventory 仍為 448 個 production source files。全域 uncovered statements 由 21,695 降為 21,623；`scripts/**` 由 19,512 降為 19,440，淨減 72，全部可歸因於本輪兩個 runner：

| Runner | statements | covered | uncovered | G7-17 uncovered | 淨減 |
|---|---:|---:|---:|---:|---:|
| `scripts/g7-commerce-browser-qa.mjs` | 615 | 112 | 503 | 554 | 51 |
| `scripts/g7-form-builder-browser-qa.mjs` | 564 | 101 | 463 | 484 | 21 |

## Ownership、計分與 blocker

- 本輪 writer scope 只有上述兩個 runner 與兩個對應 test；未覆寫其他 dirty worktree ownership。
- 這是 runner safety 與 deterministic source attribution 改善，未新增販售功能或 fresh external evidence，因此 canonical 不加分。
- Canonical 維持 total 73.5、CAT04=6.0、CAT10=4.5；其他 CAT 均至少 7。
- CAT04 fresh authorized staging／PayUni Sandbox 與 CAT10 真人法律、財務、客服 SLA、release owner、external monitoring 仍為明確 blocker。FIN-08AA、WP-196、WP-197 的既有 terminal 路徑沒有重跑。
- Coverage gate 保持 FAIL；不阻擋下一個產品功能工作。

## 回滾與下一工作

- 回滾範圍限於四個 source/test 檔案中的 helper exports、G7-05 cleanup ownership gate 與 14 個新增 contracts。
- 沒有 stage、commit、push、merge 或 deploy。
- 依最新產品優先指示，本 checkpoint 後停止追 coverage，重新從固定功能 inventory 選擇仍有顯著商家／買家操作落差的最高價值功能；CAT04／CAT10 人工或外部路徑先跳過。
