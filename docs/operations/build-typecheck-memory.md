# 建置時型別檢查的記憶體

日期：2026-11-14。對應 PR #599 的 CI 失敗（受控建置 `node scripts/build/controlled-production-build.mjs` 在 `next build --webpack` 的「Running TypeScript」階段 heap out of memory）。

## 原因

`next build` 用專案內的 `tsc` 做型別檢查（Next 16 預設），子程序沿用建置程序的預設 Node heap（本機與 CI 約 4.1 GB），不吃 `NODE_OPTIONS` 以外的設定；受控建置刻意不繼承 `NODE_OPTIONS`。

整個專案（含 1,067 個 `*.test.*`、`tests/` 下 120 個、`src/test/` 2 個與 47 個測試執行器設定，加上 `next build` 產生的 `.next/types`）完整型別檢查需要 4.2–4.4 GB：

| 範圍（`tsc --noEmit --incremental false --extendedDiagnostics`） | Types | Memory used |
|---|---|---|
| 全部，不含 `.next/types`（master b14c025a） | 2,509,525 | 4.32 GB（8 GB heap）／4.08 GB（預設 heap，剛好過） |
| 全部，含 `.next/types`（master b14c025a） | 2,566,386 | 4.38 GB（8 GB heap）；預設 heap 下時過時 OOM |
| 只有應用程式（`tsconfig.build.json`），含 `.next/types` | 1,597,765 | 2.75 GB（預設 heap）／約 3.38 GB（8 GB heap） |

master 本身就貼在上限，任何 PR 稍微增加型別都可能讓建置隨機失敗，與該 PR 的寫法無關。

## 做法

- `next.config.ts` 設定 `typescript.tsconfigPath: "tsconfig.build.json"`。這個檔 `extends` 主 `tsconfig.json`（compiler options 與 include 完全相同，含 `.next/types`），只多排除測試檔（`**/*.test.{ts,tsx,mts}`、`tests/**`、`src/test/**`）與測試執行器設定（`vitest*.config.ts`、`playwright*.config.ts`、`prisma.playwright.config.ts`）。Next 對有 `extends` 的設定檔不會自動改寫。`next dev`、`next typegen` 也讀這個檔。不使用 `ignoreBuildErrors`。
- 測試檔仍完整型別檢查：CI 的 `npm run typecheck` 檢查主 `tsconfig.json` 的全部檔案；它與 `typecheck:strict-index` 以 `node --max-old-space-size=6144` 執行。CI 是公開 repo 的 `ubuntu-latest` 標準 runner（16 GB RAM），6 GB heap 留有餘裕；CI 不快取 `tsconfig.tsbuildinfo`，每次都是完整檢查。本機的 `tsconfig.tsbuildinfo` 若是新的，`npm run typecheck` 可能沿用而不重新檢查，要確認時先刪掉它。
- `scripts/build-typecheck-config.test.ts` 守住這個約定：建置設定只能排除上述測試檔、應用程式檔全部仍在、`next.config.ts` 指向它、兩個 typecheck script 帶明確 heap。

Vercel（production 與 staging）都經由 `next build` 載入 `next.config.ts`，同樣只檢查應用程式。
