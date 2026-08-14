# G7-44 Live Studio 回訪續作與 optimistic revision 證據

- 驗證時間：2026-08-09T13:24:01.809Z
- 模式：PRELAUNCH_DEV_AUTONOMOUS／FUNC_CLOSURE
- Production side effect：無
- 外部資料修改：無

## 產品修改

1. `/lives/new` 會查詢目前商店最多三份仍有效、未 consumed、`liveId=null` 的建立中草稿。
2. 商家可看見草稿標題、保存步驟與台北時間，並以 tenant-scoped draft id 回到保存位置。
3. 指定草稿過期、已完成或不屬於目前商店時，顯示可修正警示，不載入該內容。
4. 草稿 API 改用 Prisma `updateManyAndReturn`，直接回傳本次 optimistic write 產生的 revision 與 timestamp，移除更新後再用寬鬆 `findFirst` 讀取的競態。
5. 新增可清理的 disposable PostgreSQL runner；只使用 loopback、synthetic fixtures、tmpfs container 與 canonical migrations，不載入 `.env`。
6. 新增根目錄 `PRODUCT.md` 與本機 Impeccable config，固定產品語氣、UX 原則、accessibility 與競品分析邊界；未修改 CSP。

## Reviewer finding 與修正

第一次唯讀 reviewer 找到高風險競態：分頁 A 更新成功後，可能在 reread 時讀到分頁 B 的較新 revision，卻把 A 的 payload 回給 client；下一次 A 可能使用錯誤 revision 覆蓋 B。

修正後，create-draft revive 與既有 draft update 都由 `updateManyAndReturn` 回傳同一次寫入結果。第二次 reviewer 複核確認 finding 已解除，指定範圍沒有新的可執行 finding。

## Deterministic 驗證

| 驗證 | 結果 |
|---|---|
| `npx vitest run src/app/api/live-studio/drafts/route.test.ts ... src/lib/live-studio-draft.test.ts` | exit 0；7 files、50/50 PASS |
| scoped ESLint：runner、DB test、draft route、new page 與 tests | exit 0 |
| `npm run typecheck` | exit 0 |
| `node --check scripts/g7-live-draft-disposable-qa.mjs` | exit 0 |
| `git diff --check`（本 WP scope） | exit 0；僅既有 LF/CRLF warning |
| 最終 reviewer | finding 已解除；無新 finding |

## Disposable PostgreSQL

- 首次直接使用既有 `celebratedeal_test/public`：exit 1。該 schema 過舊，缺 `LiveStudioDraft` table 與新 Live 欄位；未宣稱產品測試 PASS，也未重跑相同命令。
- 改用 `node scripts/g7-live-draft-disposable-qa.mjs`：exit 0。
- canonical migrations：50。
- Prisma validate／deploy／status：PASS／PASS／PASS。
- Live Studio draft DB tests：1 file、3/3 PASS。
- cleanup：container PASS、tempRoot PASS；結束後沒有 `celebratedeal-g7-live-draft-*` container。
- sanitized receipt：`.ai-team/reports/g7-44-live-draft-disposable-20260809.json`
- receipt SHA-256：`fe85e271ddc40afbd9471d35ebd8cf9ac5d14ce9d17cdf2733ff3e6e42d26c3f`

## Chrome／Bombmy 狀態

- Chrome extension 找到已登入的 `幫賣Bombmy`／`https://www.bombmy.live/manage-live` 分頁。
- 讀取 DOM snapshot 時逾時且 kernel reset，因此本輪沒有 Bombmy 頁面內容、截圖或互動證據。
- 沒有點擊建立、儲存、發布、刪除或交易；沒有讀取 Cookie、Token、帳密或私人內容。
- 此項記為 `TOOL_BLOCKED`，不計 Browser PASS，也不阻擋本機功能修正。

## Source digest

| 檔案 | SHA-256 |
|---|---|
| `src/app/(app)/lives/new/page.tsx` | `3a975ffff0ee30d73473ee5661d34bce389570c3265c97bdc3ba5568b139af86` |
| `src/app/(app)/lives/new/page.test.tsx` | `2b961a3b386a5dd7d594502e9b06ffacc682b9be8c9960a14c492504ff07b4f8` |
| `src/app/api/live-studio/drafts/route.ts` | `cb640570c344e14f9943b3d759bbf8a56742dae32808aab11d86372481344a1f` |
| `src/app/api/live-studio/drafts/route.test.ts` | `50124dc8114ca9efb111a07f49b6fe99aef07acda1ae550290298b66a8cc1334` |
| `src/lib/live-studio-draft.db.test.ts` | `5cb7d0491b6ac47e9ce91ed1dd363ddc3d8467f09082b9fd6f664ce880f90876` |
| `scripts/g7-live-draft-disposable-qa.mjs` | `77266aca61c438a9dc12185e0fe222a26693d76d9637576dae13c740f89d427b` |
| `PRODUCT.md` | `7fb7ff674a8a437bd858d2f30d696c3a8594070afd24c640f01b0619abfcf33a` |
| `.impeccable/live/config.json` | `ace9b2f9b222191f96a3b282a2efdfd3731a9d58bd20b769765e6754124dc8c7` |

## Ownership、限制與回滾

- Live Studio draft source 與 DB tests 為同一長程 Goal 既有未追蹤工作，本 WP 延續同一 ownership；沒有覆蓋其他 writer 或清除使用者變更。
- 未執行 build／E2E；先前同一 Goal 的 build 已在 preflight 因缺少 `CRON_SECRET` 停止，本輪沒有重跑同一失敗路徑，也沒有讀取祕密。
- 未建立 commit、push、merge 或 deploy。
- 回滾範圍限於草稿回訪 notice、atomic draft response、對應 tests、disposable runner、PRODUCT 與本機 Impeccable config；沒有 migration 或持久資料修改。

## 計分資格與下一步

- 固定功能 `live_studio` 可由 `8.5 → 8.7`：recovery `1.7 → 1.8`、UX `1.6 → 1.7`；core 2.7、integrity/security 1.0、fresh evidence 1.5 維持。
- canonical 不因本機 Live Studio 能力自動變更；CAT04／CAT10 blocker 維持。
- 下一個最高價值工作：恢復 Chrome 唯讀 Bombmy 直播／影片流程記錄，完成實際差距矩陣後，再選 Live Studio template／常駐 preview 的下一個 P1。
