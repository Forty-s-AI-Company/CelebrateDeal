---
name: celebratedeal-nextjs16-conventions
description: 修改或審查 CelebrateDeal 的 Next.js 16 程式（app router、error.tsx、proxy.ts、next/image、Server Action 表單、快取與 revalidate）前使用；強制先讀 node_modules/next/dist/docs/ 的對應文件，並檢查本專案已踩過的 16.x 慣例坑。
---

# CelebrateDeal Next.js 16 慣例

## 何時用
新增或修改 `src/app/**`、`src/proxy.ts`、`error.tsx`／`loading.tsx`、`next/image`、`<form action>`、`revalidatePath`／`revalidateTag`、`dynamic`／`revalidate` 設定，或審查這類 diff 時。專案用 `next` 16.3.8，與訓練資料中的 Next 不同，不可憑記憶。

## 必讀文件
1. `AGENTS.md` 的 Next.js 區塊。
2. `node_modules/next/dist/docs/` 中與本次 API 對應的檔案（先 `Glob` 找，再讀全文）：例如 `error.md`、`image.md`、`proxy`、`revalidatePath`、`migrating-to-cache-components.md`。
3. `docs/review-2026Q4/15-nextjs-conventions.md`（B-05 發現與位置）。
4. `docs/domain-workflows.md`「設計與互動」。

## 檢查清單
- [ ] error boundary 用 `retry`，不是 `unstable_retry`（16.3.0 起穩定、舊名 runtime 不再傳入，呼叫會變 `undefined`；B05-01）。
- [ ] 要重新取 server 資料的錯誤頁用 `retry()`；`reset` 只清 client 狀態（B05-02）。公開頁（`p/[slug]`、`global-error`）至少要有可重試或重新整理的出口（B05-03）。
- [ ] 單元測試不得手動塞已不存在的 prop 來讓測試變綠；測試要貼近 runtime 實際傳入的 props。
- [ ] `proxy.ts` 保持快速：不查 DB、不取完整 `content` JSON；需要狀態預檢時用輕量查詢或快取（B05-04）。
- [ ] `<Image priority>` 已棄用，改 `loading="eager"`／`fetchPriority="high"` 或 `preload`（B05-05）。
- [ ] client 元件不得為了一個常數匯入含 `getDb`／`auth` 的模組，常數搬到獨立檔（B05-06）。
- [ ] 所有 `<form action>` 的送出鈕用 `src/components/form-submit-button.tsx`（或 `ui.tsx` 的 `SubmitButton`／`DangerButton`），不用裸 `<button>`；要有 pending、防重送與回音（PRODUCT.md 原則 4；B05-09，金流相鄰表單優先）。
- [ ] `params`、`searchParams`、`cookies()` 都 `await`；不新增 `middleware.ts`、`unstable_cache`、`preferredRegion`、單參數 `revalidateTag`。
- [ ] 新增 `dynamic = "force-dynamic"`／`revalidate` 前確認不與未來 `cacheComponents` 衝突，並記入遷移清單（B05-10）。
- [ ] `revalidatePath("/", "layout")` 這類大範圍失效有理由，否則縮小範圍（B05-11）。

## 禁止事項
- 不憑記憶或舊版教學寫 Next API；讀不到文件就停下回報。
- 不為了讓測試通過而改 assertion 或加假 prop。
- 不在 proxy 內新增 DB 讀取。

## 完成證據
收據列出實際讀過的 docs 檔案路徑、跑過的 targeted test（含 exit code）、`npm run typecheck`／`npm run lint` 結果；沒跑的明寫未跑。涉及 error boundary 時附一次真實瀏覽器或元件觸發 `retry` 的證據。
