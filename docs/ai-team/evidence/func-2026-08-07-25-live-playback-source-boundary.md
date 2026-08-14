# FUNC-2026-08-07-25 — Live admission server playback source boundary

## 結果

本輪完成直播播放來源的本機 P1 功能閉環。公開直播頁不再查詢或傳遞 `videoUrl` 到 RSC／client props；只有在 server-side admission 建立未過期、vendor/live 綁定的 HttpOnly viewer session 後，client 才能向新的 source endpoint 取得播放來源。

主要修復：

- `src/app/live/[slug]/page.tsx` 移除 public page 的 video relation query 與 `videoUrl` prop mapping。
- 新增 `GET /api/live-playback-source`，要求 same-origin、client marker、bounded query、rate limit 與有效 admission cookie。
- source resolver 以 token hash 查詢 session，fail closed 驗證 vendor/live、expiry、live lifecycle 與安全 HTTP(S) playback URL。
- blocked／expired／cross-vendor／cross-live／missing source 只回 bounded generic response，成功 response 設 `private, no-store`。
- `LivePlayback` 在 admission 後才 fetch source；admission 前與失敗狀態不把 URL 放入 `<video src>`。
- 補 public page、route、domain、component regression，並將新增 route 登錄到 API contract registry。

## 實際驗證

- targeted source/page/route contract：4 files，15 passed、0 failed、0 skipped。
- full Vitest：195 files，1378 passed、0 failed、0 skipped。
- Node contracts：679 passed、0 failed、0 skipped。
- `npm run typecheck`：PASS。
- scoped ESLint（本輪 source/test scope）：0 errors。
- `npm run secret:scan`：`secret_scan_passed`。
- `git diff --check`：PASS；只見既有 LF／CRLF normalization warnings。
- API contract registry：33/33 route methods，33/33 same-path route tests。
- `node scripts/readiness-truth-reconciliation.mjs`：PASS，10 categories、canonical total 73.5、G1 CLOSED、SANDBOX_READY false、PRODUCTION_READY false。

## 為什麼總分仍是 73.5

這輪關閉的是本機 P1 播放來源邊界，沒有產生 CAT04 所需的 fresh staging reconciliation／PayUni provider receipt，也沒有產生 CAT10 所需的真人 merchant、客服、法律／隱私、退款、財務、release owner 或 external monitoring evidence。因此本輪 `current_goal_score_change=0`。

最新 canonical snapshot：

| Category | 分數 | 目前狀態 |
|---|---:|---|
| CAT01 | 7.5 | 已達標 |
| CAT02 | 8.0 | 已達標 |
| CAT03 | 8.0 | 已達標 |
| CAT04 | 6.0 | 等 fresh staging／PayUni receipt |
| CAT05 | 8.5 | 已達標 |
| CAT06 | 7.0 | 已達標 |
| CAT07 | 9.0 | 已達標 |
| CAT08 | 7.5 | 已達標 |
| CAT09 | 7.5 | 已達標 |
| CAT10 | 4.5 | 等真人 owner／external monitoring |
| **Total** | **73.5** | **Goal 尚未完成** |

Readiness runner 的 `score_change=0.5` 是歷史 WP-131 欄位，不是 FUNC-25 的 uplift。

## Coverage 與邊界

- 本輪沒有重算 global coverage；最新 authoritative QUAL-19 仍為 statements／branches／functions／lines `40.73／46.56／49.25／61.16`，低於未變更的 `63／57／60／65` gate。
- 沒有降低 threshold、inventory、exclude、skip 或 assertion；coverage gate 沒有阻擋本輪功能回歸。
- 沒有讀取或輸出 `.env*`、credential、token、cookie、production secret、production customer／payment data。
- 沒有執行 staging mutation、PayUni call、production operation、deployment、push、merge、付款、退款或寄信；沒有重試 FIN-08AA、WP-196、WP-197。
- worktree 保持未 staged；既有使用者／前序 WP dirty hunks 保留不動。

## 下一步

維持 `FUNC-CLOSURE`。下一個高價值路徑是另一個可本機閉合的 P1 販售功能，或在取得明確授權與有效外部條件後完成 CAT04 fresh staging／PayUni receipt；CAT10 仍只能由真人 owner 與 external monitoring evidence 關閉。
