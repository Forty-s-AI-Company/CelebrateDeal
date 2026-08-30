# G7-17 current-tree coverage truth 與測試收斂

- 結果：`FUNCTION_AND_CONTRACT_TESTS_PASS_COVERAGE_GATE_FAIL`
- 執行模式：`PRELAUNCH_DEV_AUTONOMOUS`
- Goal：`ACTIVE`

## 本輪完成

- `scripts/run-combined-coverage.mjs` 每輪建立 loopback-only PostgreSQL 16 disposable container，使用完整 44 migration no-dotenv mirror 後才執行 coverage。
- child process 使用最小合成環境，不繼承 developer secret；不設定或改寫 `HOME`、`USERPROFILE`、`CODEX_HOME`。
- cleanup 只有在 container ID、name、run-id label、marker label、tmpfs mount、database comment 與 schema comment 全部吻合時才刪除精確容器；暫存目錄也要求 tmp-root、名稱格式與 marker 完全吻合。
- API contract registry 更新為 45/45 routes；Prisma inventory 更新為 84/84 models、44/44 migrations。
- 過期 source-string／format contract 與 password-reset PII redaction assertion 已更新，沒有降低 assertion。
- `src/app/actions.test.ts` 改以現行 `generateSettlementForVendor` boundary 驗證 action，並以 `resetAllMocks` 阻止 one-shot transaction fixture 跨 case 污染。
- 認證、password reset、MFA 與 session Server Actions 抽到 `src/app/actions/auth-security-actions.ts`；root action module 為 2,229 行，低於既有 2,300 行上限。

## Current deterministic truth

- Vitest：308/308 files PASS，2,074/2,074 tests PASS，0 skipped。
- Node TAP contracts：698/698 PASS，0 skipped。
- TypeScript：PASS。
- Scoped ESLint：PASS。
- Architecture + root actions targeted verification：206/206 PASS。
- Disposable PostgreSQL cleanup：container `PASS`、temp root `PASS`。
- Coverage threshold：`FAIL`，沒有調低或移除門檻。

| Metric | current | gate | 結果 |
|---|---:|---:|---|
| Statements | 43.87%（16,959／38,654） | 63% | FAIL |
| Branches | 48.51%（15,701／32,360） | 57% | FAIL |
| Functions | 52.52%（3,229／6,147） | 60% | FAIL |
| Lines | 61.74%（14,755／23,895） | 65% | FAIL |

## Source attribution

完整 coverage map 含 448 個 production source files。未覆蓋 statements 共 21,695，其中 `scripts/**` 佔 19,512，約 89.94%。

| Area | statements | uncovered | functions uncovered | branches uncovered |
|---|---:|---:|---:|---:|
| `scripts/**` | 26,737 | 19,512 | 2,475 | 13,897 |
| `src/app/**` | 4,701 | 819 | 143 | 1,192 |
| `src/components/**` | 1,480 | 649 | 243 | 623 |
| `src/lib/**` | 5,729 | 708 | 56 | 933 |
| other | 7 | 7 | 1 | 6 |

最大 statement gaps 依序包含 `scripts/g7-commerce-browser-qa.mjs` 554、`scripts/g7-form-builder-browser-qa.mjs` 484、`scripts/wp153-public-unavailable-browser-runner.mjs` 462、`scripts/wp149-public-unavailable-browser-runner.mjs` 409、`scripts/wp151-public-unavailable-browser-runner.mjs` 409。這些 runner 的實際 Browser／disposable 執行證據不能自動等同 V8 unit coverage；下一輪需要拆出可測 pure helpers 與 fail-closed orchestration contracts。

## 分數與 blocker

- 本輪提升 current-tree test reliability 與 truth quality，未形成 canonical 分數上調。
- Canonical 維持 73.5；CAT04=6.0、CAT10=4.5，其他 CAT 均至少 7。
- CAT04 仍需要 fresh authorized staging／PayUni Sandbox provider 與 reconciliation evidence，既有 FIN-08AA／WP-196／WP-197 terminal 路徑沒有重跑。
- CAT10 仍需要真人法律、隱私、退款、財務、客服 SLA、release acceptance 與 external monitoring delivery。
- Coverage gate 仍是 QUAL blocker；不影響已通過的功能與 E2E evidence，也沒有被標成 PASS。

## 回滾與下一步

- 回滾範圍限於 disposable coverage runner、契約 inventory／tests、password-reset test、root action test，以及 auth-security action extraction。
- 沒有 stage、commit、push、merge、deploy、Production、正式付款／退款／寄信或外部副作用。
- 下一個最高價值 QUAL work 是先補 `scripts/g7-commerce-browser-qa.mjs` 與 `scripts/g7-form-builder-browser-qa.mjs` 的 pure-helper／ownership／cleanup contract coverage，再依 current map 重新排序；禁止擴大 exclude、刪 inventory、加 skip 或降低 gate。
- 依使用者要求，本輪在 current-tree tests 全綠、coverage truth 可追溯的 checkpoint 停下。
