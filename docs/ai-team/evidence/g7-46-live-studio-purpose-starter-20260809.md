# G7-46 Live Studio 用途範本與安全草稿保存

- Work Package：G7-46
- 日期：2026-08-09（Asia/Taipei）
- 最終驗收時間：2026-08-09T14:26:15.306Z
- 模式：PRELAUNCH_DEV_AUTONOMOUS
- 結果：PASS
- Writer：主 control-plane
- Browser QA：Codex Terra High

## 產品問題與使用者價值

商家進入五步 Live Studio 時，原本直接看到完整表單，必須自行判斷銷售直播、內容直播與空白設定的差異。G7-45 已加入常駐預覽，本輪再補上建立用途開始器，降低第一次設定時的思考量，同時保留既有草稿、refresh recovery、revision conflict 與發布檢查。

本輪完成：

1. 新建直播提供「商品銷售直播」、「內容／課程直播」、「從空白開始」三種用途。
2. 用途只補空白欄位與操作提示，不移除選擇、不覆寫商家已輸入內容。
3. 商品銷售用途只在促銷短句為空時填入安全預設；其他商家內容保持不變。
4. 用途寫入 `studioPreset` 草稿欄位，legacy 草稿預設為 `CUSTOM`，refresh 後可恢復。
5. `studioPreset` 使用受控 hidden input，React commit 完成後再排程儲存，避免 UI 顯示已選但草稿仍為舊值。
6. edit 頁不顯示開始器，避免對既有直播重新套用範本。
7. 選擇卡支援 `aria-pressed`，變更結果由 live status 說明；既有桌面常駐預覽與行動版可展開預覽保持可用。
8. Browser runner 新增 `--focus-live-studio-starter`，receipt 標示 G7-46，並把草稿 hook、schema 與 client serialization 納入 source attestation。

## Source lineage

| 路徑 | SHA-256 |
|---|---|
| `src/components/live-stepper-form.tsx` | `fd7f37955b93dad71c633066174e4dc84e57d40fb88d8afe85e431676288808d` |
| `src/components/live-stepper-form.test.tsx` | `25a7de1851422aa9310d2b78b9f9a5d1cda767968e7865a3dbf26a2e34a7db66` |
| `src/components/use-live-studio-draft.ts` | `ba7a37401204ce9df51f39a6658d4056881641653ac09c973856b9605955e46c` |
| `src/lib/live-studio-draft.ts` | `65c30370c5ab10e59f1511fad54374430524a0249d48e400b1329b6f09ff3167` |
| `src/lib/live-studio-draft.test.ts` | `360cb8cebb531b23782e5a68cf7d621e156c4b8a3387be434f2a2ee5cecb0882` |
| `src/lib/live-studio-draft-client.ts` | `2f6533a049fe43987f879094b20ac79f98da7d17bbe268764085c7f1c8ad31b8` |
| `src/lib/live-studio-draft-client.test.ts` | `d71634e269f82e34817044cf374621a5fb201026485dab31c3c2d10a5398faea` |
| `tests/e2e/commerce-orders.spec.ts` | `5bba9ffdb46534a2d65e7b1f2aa0eef2744e8ccfee5c7ba97c43399597a6db91` |
| `scripts/g7-commerce-browser-qa.mjs` | `b1e6875a418a30b1d8eda5fcd25e9ee507cf51d727fb47efb6746f86ec3bf039` |
| `scripts/g7-commerce-browser-qa.test.mjs` | `1d87da5852e2de91984313cfa5fd788aaf8a871d0423bc2410304e28dc384da4` |

## Deterministic 與 Browser 證據

### PASS

- `npx vitest run src/lib/live-studio-draft.test.ts src/lib/live-studio-draft-client.test.ts src/components/live-stepper-form.test.tsx`
  - 3 files、28 tests PASS。
  - 覆蓋用途 enum、legacy `CUSTOM`、非法用途拒絕、serialization、create／edit 可見性、hidden input 與不送出表單。
- `node --test scripts/g7-commerce-browser-qa.test.mjs`
  - 14/14 PASS，包含 G7-46 flag、work package、雙 RWD 截圖與三個 draft runtime source attestation。
- scoped ESLint：PASS。
- `npm run typecheck`：PASS。
- scoped `git diff --check`：exit 0；只有既有 LF／CRLF warning，沒有 whitespace error。
- Terra High：`node scripts/g7-commerce-browser-qa.mjs --focus-live-studio-starter`
  - exit code 0。
  - receipt：`docs/ai-team/evidence/g7-46-live-studio-browser-qa-cf2ead3c463aa63a.json`
  - receipt SHA-256：`281fdcfec92d6dd2f59d1746d42f6dfe667831861a0dc1ce8a28064ab834ba09`
  - production Next build PASS。
  - Prisma generate／validate／50 migrations／status PASS。
  - Browser 1/1 PASS、0 failed、0 skipped。
  - Axe critical/serious = 0；RWD PASS。
  - server、精確 ownership container、temp root cleanup 全部 PASS。
  - `dotenvContentsRead=false`、`externalOperations=false`、`productionOperations=false`。
  - 桌面截圖：`g7-04-browser-qa-cf2ead3c463aa63a-screenshots/live-studio-desktop.png`，SHA-256 `5d7c5813626b4305ee67ce0ece782e8bd89af0c1c01686fda850c6f6af9b54c8`。
  - 行動截圖：`g7-04-browser-qa-cf2ead3c463aa63a-screenshots/live-studio-mobile.png`，SHA-256 `820fac43ceb8959590ee806f5ca479791109139899b2d1689604be854b8ab3cc`。
  - 最終 receipt source lineage 已包含 `src/components/use-live-studio-draft.ts`、`src/lib/live-studio-draft.ts`、`src/lib/live-studio-draft-client.ts`。

### 如實保留的失敗與修正

| 證據／命令 | 結果 | 處理 |
|---|---|---|
| `g7-45-live-studio-browser-qa-b2b34c5538c75c73.json`，SHA-256 `2a85e48bffe437c8e7665cbe392d9d1a567c9424619c3b520546f2b449b12a7c` | Browser FAIL，點選後 hidden `studioPreset` 仍為 `CUSTOM` | 改為受控 input，待 React commit 後排程草稿保存；後續 focused Browser PASS |
| `g7-46-live-studio-browser-qa-dfe19cbfb8395017.json`，SHA-256 `a234d79295dbf616d6e9ff3a33ab3b79faae7a7b9ee216c822f27630e620f222` | Browser PASS，但 receipt 尚未包含三個 draft runtime source digest | 擴大 source attestation 後產生本文件引用的 final receipt |
| runner static test 初次 13/14 | 路徑 RegExp assertion 寫法錯誤 | 改用精確 quoted path presence，最終 14/14 PASS |
| `npx tsx --test ...` | 工具使用錯誤，Vitest 無法由 CommonJS runner 載入 | 改用專案 Vitest runner，最終 28/28 PASS；不列為產品失敗 |

未執行或失敗的項目均未標示為 PASS。

## 計分與 blocker

- `live_studio` 功能分數具資格由 8.9 提升為 9.0：UX 1.9 → 2.0。
- canonical CAT01～CAT10 維持 74；CAT04=6、CAT10=4.5。本輪沒有 PayUni Sandbox／staging 外部交易證據，也沒有真人法律、財務、客服、監控或 release 簽核。
- Goal 維持 ACTIVE。
- 本輪不需要使用者手動處理；CAT04／CAT10 待辦繼續列管，不阻擋下一個本機功能工作。

## Ownership 與回滾

- 接管範圍限於上表 G7-46 component、draft schema／client、tests、Browser runner hunks、本 evidence、final receipt／截圖與 scorecard 更新。
- 未修改 Prisma schema 或 migration，未操作外部／正式服務，未 commit、push、merge 或 deploy。
- 回滾時只移除用途開始器、`studioPreset` 草稿欄位與 G7-46 tests／runner flag／evidence；不得回滾既有五步草稿、revision conflict、常駐預覽、媒體、Email、商品或其他 dirty worktree 變更。

## 下一個最高價值工作

G7-47 候選是買家訂單自助入口：讓已取得 order-bound capability 的買家安全查看付款、履約、數位授權、服務進度與退款狀態，沿用最小化 PII、遮罩、租戶／訂單綁定與權限失效規則。先做 current source 與資料模型審查，確認不與現有客服案件 grant 重複，再決定最小可販售範圍。
