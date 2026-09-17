# 自動化 Webinar checkpoint evidence

## Scope

啟用第四種 Funnel Goal；四個獨立 PageDocument、一般節點模板、步驟與頁面 history、固定 UTC 排程與 IANA 時區、既有 Live/Video/Form 選擇、Preview/public 共用 renderer、公開播放 handoff 與發布驗證。未新增資料庫 schema，未操作正式資料、正式寄信或部署。

產品定義、既有能力盤點與 systeme.io 未實測部分見 `docs/product/webinar-funnel.md`。本次不宣稱 Webinar parity，也不導入參考站方案限制。

## Checks

- `node node_modules/typescript/bin/tsc --noEmit`：exit 0。
- `node node_modules/eslint/bin/eslint.js .`：exit 0；只有既有 `landing-page-puck-config.tsx` 的 3 個 `no-img-element` warnings。本次最後調整另跑 targeted ESLint，exit 0。
- `node node_modules/vitest/vitest.mjs run`，下列 15 檔：117 tests PASS。
  - `src/lib/funnel-webinar.test.ts`
  - `src/lib/funnel-webinar-media.test.ts`
  - `src/lib/funnel-flow.test.ts`
  - `src/lib/funnel-goal-step-pages.test.ts`
  - `src/lib/funnel-template-gallery.test.ts`
  - `src/lib/funnel-step-pages.test.ts`
  - `src/lib/funnel-step-pages-history.test.ts`
  - `src/lib/funnel-page-history.test.ts`
  - `src/lib/funnel-page-document.test.ts`
  - `src/lib/landing-page-service.test.ts`
  - `src/app/actions/landing-page-actions.test.ts`
  - `src/app/lp/[slug]/page.test.tsx`
  - `src/app/lp/[slug]/[stepPath]/play/route.test.ts`
  - `src/components/landing-pages/funnel-webinar-experience.test.tsx`
  - `src/components/landing-pages/funnel-page-document-renderer.test.tsx`
- 最終 production build、browser integration（1 條完整流程，13.6 秒）、85 個 disposable migration 與 cleanup 全部 PASS。`receipt.json` 的 source SHA-256 為 `fc221036ac580a770133f826eb2ed4d30839ccab16eed16031177e18accf7fd4`；browser test SHA-256 為 `93645c9e585077b9650db5fecd1ea595feefbec777107a57793d5db52eb5d693`。每次執行的歷史 receipt 保留，不改寫失敗紀錄。

## Browser integration

`node scripts/webinar-funnel-disposable-qa.mjs --refresh-build` 使用不含 `.env*` 的 source-only mirror，實際執行 Next production build、85 個 migration、Chrome 與新建 loopback disposable PostgreSQL；只使用合成帳戶與資源。清理前驗證 container 唯一 identity。`--reuse-build` 僅允許 source digest 完全相同；receipt 同時保存 source 與 browser test SHA-256。

驗收包含四 Goal 入口、建立 Webinar、改名稱/URL、流程與頁面 Undo/Redo、獨立頁面、Save/reload、缺資源拒絕發布、選取真實 fixture 資源、發布、desktop/mobile Preview、原生表單提交及未驗證名單狀態、四個公開頁重載、375px 無水平溢位與伺服器 303 導向 Live。fixture 影片為不可外連的合成來源；此測試驗證導向與權限邊界，並未宣稱實際外部影音 CDN 播放成功。

調查過程包含測試 selector 修正，以及實際修正儲存後 transition 長時間 pending、revision 更新重建 workspace 與後續 Preview 操作競爭。失敗 screenshots 與 receipt 為診斷證據，不是目前通過狀態。未使用 skip、降低 assertion 或手動重載繞過操作問題。

## Rollback / next step

本地 checkpoint 可用一般 revert 撤銷；回到舊版前先取消發布 Webinar Funnel，因舊 parser 不支援其 JSON。既有 GitHub Actions 已每次 push/PR 執行 ESLint、unit checks 與 E2E，本次不變更門檻。後續使用者可綁定自己專案已授權的 Live 與影片驗收內容；production deployment 仍為獨立人工授權。
