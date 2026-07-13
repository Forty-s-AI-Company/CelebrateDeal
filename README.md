# CelebrateDeal

CelebrateDeal 是以 Cloudflare 為優先整合方向的直播導購 SaaS，專案以既有的 Next.js 應用程式與 Prisma 資料層支援本機開發、測試與正式環境作業。

## 技術棧

- Next.js 16.2.10、React 19、TypeScript
- Prisma 與 PostgreSQL

## 本機開發（WSL）

請在 WSL 的 Linux 檔案系統中使用此工作目錄，並以本機 PostgreSQL 進行開發；舊 SQLite 資料僅供歷史 demo 參考。資料庫連線與環境設定請依 [Production Database Runbook](docs/production-database-runbook.md) 建立本機設定，切勿將正式環境的連線或祕密寫入日常開發環境。

```bash
nvm use
npm ci
npm run db:generate
npm run dev
```

開發伺服器預設使用 port `31023`。啟動後可在 `http://localhost:31023` 開發。

## 必要驗證

提交前依序執行下列四項驗證：

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

### WSL 一鍵驗證

首次使用請先執行 `npm ci`。之後可使用下列指令執行與 CI 相同 Node.js major 的 lint、typecheck、unit test 與 build：

```bash
bash scripts/validate-local.sh
```

此腳本會依 `.nvmrc` 選用 WSL 原生 Node.js 22，並在偵測到 Windows-mounted temporary path 時改用 `/tmp`，避免 `tsx` IPC socket 失敗。它只為 unit test 提供未持久化的非正式測試值；不會執行 migration、seed、E2E、部署或讀取真實祕密。

## 作業文件

- 正式環境與上線：[Production Infrastructure Plan](docs/production-infrastructure-plan.md)、[Production Go-live Checklist](docs/production-go-live-checklist.md)
- Cloudflare：[Cloudflare Stream Dashboard Checklist](docs/cloudflare-stream-dashboard-checklist.md)
- 付款：[PayUni Sandbox Checkout Runbook](docs/payuni-sandbox-checkout-runbook.md)
- 安全性：[Admin MFA Hardening Plan](docs/admin-mfa-hardening-plan.md)、[Production Rate Limit Runbook](docs/production-rate-limit-runbook.md)

## 安全界線

一般本機驗證不包含 migration、seed、部署、E2E 測試、真實付款操作或使用真實祕密。這些操作僅能依 `docs/` 中相應 runbook，在明確授權且隔離的環境進行。
