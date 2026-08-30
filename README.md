# CelebrateDeal

CelebrateDeal 是以 Cloudflare 為優先整合方向的直播導購 SaaS，專案以既有的 Next.js 應用程式與 Prisma 資料層支援本機開發、測試與正式環境作業。

## 技術棧

- Next.js 16.2.11、React 19、TypeScript
- Prisma 與 PostgreSQL

## 本機開發（Windows PowerShell，已驗證）

目前已驗證的主要開發環境是 Windows 原生 PowerShell、Node.js 22 與 PostgreSQL 18。舊 SQLite 資料僅供歷史 demo 參考。資料庫連線與環境設定請依 [Production Database Runbook](docs/production-database-runbook.md) 建立本機設定，切勿將正式環境的連線或祕密寫入日常開發環境。

```powershell
nvm use 22
npm ci
npm run db:generate
npm run dev
```

開發伺服器預設使用 port `31023`。啟動後可在 `http://localhost:31023` 開發。

本機測試只接受 loopback PostgreSQL 與 `celebratedeal_dev`、`celebratedeal_test`、`celebratedeal_e2e` 或 `celebratedeal_ci` 這類隔離資料庫名稱。Vitest 與 Playwright 會在測試啟動前 fail-closed，避免 `.env.local` 誤指 Staging 或 Production。

## 必要驗證

提交前依序執行：

```powershell
npm run lint
npm run typecheck
npm run test:coverage
npm run secret:scan
pwsh -NoProfile -File ops/backup/tests/Test-BackupTooling.ps1
npm run e2e
npm run build
npm audit --omit=dev --audit-level=high
```

`e2e` 會自行 build/start Next production server，並執行 smoke、accessibility 與固定路徑 performance Gate；請等待 Playwright 完整結束與 webServer teardown，不要在測試仍進行時另外啟動 `next build`。

### WSL 替代路徑

若團隊選用 WSL，請將 repo 放在 Linux 檔案系統而不是 Windows mounted path。首次使用先執行 `npm ci`，之後可用：

```bash
bash scripts/validate-local.sh
```

此腳本會依 `.nvmrc` 選用 WSL 原生 Node.js 22，並在偵測到 Windows-mounted temporary path 時改用 `/tmp`，避免 `tsx` IPC socket 失敗。它只為 unit test 提供未持久化的非正式測試值；不會執行 migration、seed、E2E、部署或讀取真實祕密。Windows 原生流程不需要執行此腳本。

## 作業文件

- 文件的現況／歷史快照／runbook 邊界：[文件權威與時效地圖](docs/DOCUMENT_AUTHORITY.md)
- 目前 revision 進度、QA 與評分：[Codex Goal](docs/codex-goal/README.md)
- 團隊展業 Epic 稽核與交接：[Team Funnel Replication Audit](docs/team-funnel-replication.md)
- 正式環境與上線：[Production Infrastructure Plan](docs/production-infrastructure-plan.md)、[Production Go-live Checklist](docs/production-go-live-checklist.md)
- Cloudflare：[Cloudflare Stream Dashboard Checklist](docs/cloudflare-stream-dashboard-checklist.md)
- 付款：[PayUni Sandbox Checkout Runbook](docs/payuni-sandbox-checkout-runbook.md)
- 安全性：[Admin MFA Hardening Plan](docs/admin-mfa-hardening-plan.md)、[Production Rate Limit Runbook](docs/production-rate-limit-runbook.md)

## 安全界線

一般本機驗證不包含 migration、seed、部署、E2E 測試、真實付款操作或使用真實祕密。這些操作僅能依 `docs/` 中相應 runbook，在明確授權且隔離的環境進行。
