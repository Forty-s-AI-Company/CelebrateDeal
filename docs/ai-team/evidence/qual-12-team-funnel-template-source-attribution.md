# QUAL-12 — Team funnel template action source attribution

日期：2026-08-07  
結果：`COMPLETE_LOCAL_DETERMINISTIC_TESTS`；coverage global gate 仍未達標。

## 覆蓋範圍

- 補上 `src/app/actions/team-funnel-template-actions.test.ts` 的 create／publish success paths。
- 驗證 source page 建立、selected product slot、scoped webinar source lineage、template version publish 與 vendor/team ownership update。
- 所有測試使用 deterministic mocks；沒有 staging、PayUni、Production 或正式資料副作用。

## 可追溯驗收結果

- targeted：1 file，6 passed，0 failed，0 skipped。
- full Vitest：175 files，1280 passed，0 failed，0 skipped。
- Node contracts：620/620 passed。
- combined coverage：global statements／branches／functions／lines 為 38.86／44.82／47.17／59.21，低於既有 63／57／60／65，標示 `FAIL_REMAINING_SOURCE_INVENTORY`。
- scripts attribution：27.15／35.48／33.23／46.52；src attribution：83.00／75.90／83.02／85.57。
- 相較 QUAL-11，global 四項提升 0.11／0.09／0.11／0.18 個百分點；仍不代表 coverage gate 通過。
- 沒有修改 threshold、inventory、exclude、skip 或 assertion。

## 邊界與評分

本包沒有讀取 `.env*`、Token、Cookie 或 Secret，也沒有執行正式付款／退款／寄信。CAT04 維持 6.0、CAT06 7.0、CAT10 4.5、總分 73.5；CAT06 staging blocker、CAT10 真人法律／客服／monitoring／release owner evidence 與外部 provider evidence 仍 pending。FIN-08AA、WP-196、WP-197 均未重試。

證據檔：`.ai-team/reports/qual12-team-funnel-template-source-attribution.json`。
