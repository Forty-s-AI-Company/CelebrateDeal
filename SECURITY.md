# 安全政策

## 回報漏洞

請不要用公開 issue、PR 或討論區回報漏洞。請到本 repo 的 **Security → Report a vulnerability** 送出私下回報（GitHub private vulnerability reporting）。回報時請附上受影響的路徑或功能、重現步驟與可能的影響；不要附上真實的客戶資料、付款資料或任何密鑰。

測試時請只使用自己建立的帳號與合成資料，不要存取、修改或刪除其他商家或買家的資料，也不要對正式環境做壓力測試。

## 相依性漏洞的處理時限

時限從 advisory 公開、且確認影響本專案起算。

| 嚴重度 | 正式環境相依 | 僅開發／建置相依 |
|---|---|---|
| critical | 24 小時內修補或下線受影響功能 | 7 天 |
| high | 7 天 | 30 天 |
| moderate | 30 天 | 隨例行更新 |

無法在時限內修補時，在追蹤 issue 記錄原因、暫時緩解方式與到期日。

## 自動化預警

| 機制 | 觸發 | 結果 |
|---|---|---|
| Dependabot security updates（repo 設定） | advisory 公開 | 自動開修補 PR |
| Dependabot version updates（`.github/dependabot.yml`） | 每週一（npm）、每月（GitHub Actions） | 分組的 minor／patch 更新 PR；major 升級不自動開 |
| CI `Production dependency audit`（`.github/workflows/ci.yml`） | 每個 PR 與 merge queue | 正式環境相依有 high 以上即失敗 |
| Dependency review（`.github/workflows/dependency-review.yml`） | 動到相依清單或 CI 定義的 PR | 新引入 high 以上 advisory 即失敗 |
| 每週稽核（`.github/workflows/security-audit.yml`） | 每週一 09:17（台北） | 含開發相依；有 high／critical 時開一張 `security-audit` issue 並指派給 repo owner，每週留言直到解決 |
| Secret scanning 與 push protection（repo 設定） | 每次 push | 擋下已知格式的密鑰 |
| `npm run secret:scan`（CI） | 每個 PR | 掃描私鑰、token、正式金流金鑰與外部資料庫連線字串 |

## 收到警示後的步驟

1. 讀 advisory，確認受影響的套件是直接或間接相依、是否在正式環境的相依樹（`npm audit --omit=dev`），以及本專案是否真的走到有問題的程式路徑。
2. 優先升到同一個 major 的修補版；間接相依先升上游套件，上游還沒修才用 `package.json` 的 `overrides`，並在 PR 說明移除條件。
3. 不採用 `npm audit fix --force`，也不採用會降 major 的建議（例如把 `eslint-config-next` 降版）。
4. 在 `ai/*` 分支修改，跑 `npm audit`、`npm run typecheck`、`npm run lint` 與相關測試，經 PR 與 `quality` CI 合併。
5. 需要升 major 或暫時無解時，在追蹤 issue 記錄例外與到期日。

## 範圍外

不讀取、輸出或傳送 `.env*`、密碼、token、cookie、私鑰、正式 secret、正式客戶資料與付款資料；這條規則同樣適用於所有自動化代理（見 `AGENTS.md`）。
