# QUAL-2026-08-07-01：secret-scan source attribution 與最新 coverage evidence

## 結論

本輪完成 secret-scan 行為的 deterministic source-attribution tests，並完成最新完整測試與 coverage reconciliation。功能測試與 contract tests 全部通過，但 global coverage gate 仍未達到既有門檻，且獨立 secret scan 仍有 47 筆 `external_database_url` inventory findings；因此本輪是 `PARTIAL_CLOSURE`，Goal 維持 `IN_PROGRESS`。

## 可重現結果

| 驗證 | 實際結果 |
| --- | --- |
| `npx vitest run scripts/secret-scan.test.ts --reporter=dot` | 1 file、5 passed、0 failed、0 skipped |
| `npm test` | 181 files、1317 passed、0 failed、0 skipped |
| `npm run test:contracts` | 620 passed、0 failed、0 skipped |
| `npm run secret:scan` | FAIL；47 筆 `external_database_url`，未輸出來源值 |
| `npm run test:coverage` | FAIL_REMAINING_SOURCE_INVENTORY |

## Coverage reconciliation

`coverage/coverage-summary.json` 的最新全域結果如下；既有 global threshold 沒有修改：

| 指標 | Covered / Total | 實際 | 門檻 |
| --- | ---: | ---: | ---: |
| Statements | 12021 / 30548 | 39.35% | 63% |
| Branches | 11184 / 24797 | 45.10% | 57% |
| Functions | 2233 / 4690 | 47.61% | 60% |
| Lines | 10530 / 17646 | 59.67% | 65% |

source attribution 分項為 `scripts`：27.15% statements、35.48% branches、33.23% functions、46.52% lines；`src`：82.58% statements、75.05% branches、82.96% functions、85.40% lines。

沒有新增 skip、沒有擴大 exclude、沒有降低 threshold，也沒有弱化 assertion。新增測試只驗證既有 secret-scan 對 loopback database、external database、fixture marker、私鑰／付款素材與 archive extension 的既定分類行為；不會把 inventory finding 標成 PASS。

## 安全與 release 邊界

- 沒有操作 production database、production payment、正式退款、正式寄信或外部服務。
- 沒有重試 FIN-08AA、WP-196 或 WP-197 的禁止路徑。
- CAT 分數沒有因本輪 local qualification evidence 自動上調；CAT10 的真人法律／財務／release 簽核與外部 telemetry 仍待完成。

## 下一步

以 source-specific remediation 處理 47 筆 secret-scan inventory，並持續完成必要的產品功能與 release reconciliation；coverage gate 在真正達標前維持 FAIL 證據。
