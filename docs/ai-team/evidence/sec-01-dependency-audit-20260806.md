# SEC-01 Dependency audit — 2026-08-06

## Scope

本次只處理依賴安全，不讀取 `.env*`、憑證、Token、Cookie、正式資料，未操作資料庫、Docker、PayUni、部署或正式服務。既有 `package.json` scripts 與其他 dirty hunks 保留；本次新增的 dependency 變更只限既有 `overrides` 與 lockfile 解析結果。

## Before

- `npm audit --omit=dev --json`: 2 high vulnerabilities。
- 受影響 transitive packages：`brace-expansion` 5.0.8、`fast-uri` 3.1.4。

## Remediation

- `fast-uri` override：`^3.1.4` → `^3.1.5`。
- `minimatch@10.2.5` 只使用相容 major 的 `brace-expansion` `^5.0.9`。
- `minimatch@3.1.5` 只使用相容 major 的 `brace-expansion` `^1.1.18`。
- `npm install --ignore-scripts --no-audit --no-fund` 完成，未執行 lifecycle scripts。

## Verification

| Check | Result |
|---|---|
| `npm audit --omit=dev --json` | PASS；high 0、critical 0、total 0 |
| `npm audit --json` | PASS；high 0、critical 0、total 0 |
| `npm ls brace-expansion fast-uri --all --json` | PASS；無 invalid dependency |
| `npm run lint` | PASS；0 errors、既有 2 warnings 未增加 |
| `npm run typecheck` | PASS |
| `git diff --check` | PASS |

## Score impact

「依賴安全」由 `5/10` 提升為候選 `7/10`。此分數只代表目前 manifest／lockfile 的新鮮 audit evidence；不外推為正式部署或正式環境安全完成。

## Stop / follow-up

本輪未執行 global coverage 或 E2E：coverage gate 仍是已知低價值迴圈，E2E 必須等 global `63/57/60/65` 全部通過後才可執行。CAT04 仍受 WP196/WP197 的終局外部 Preview／Sandbox binding 缺口阻擋，未將依賴 audit 誤分類為金流或 schema evidence。
