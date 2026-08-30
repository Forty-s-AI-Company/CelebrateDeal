# G7-47 買家訂單自助查詢與安全履約投影

- Work Package：G7-47
- 日期：2026-08-09（Asia/Taipei）
- 最終驗收時間：2026-08-09T15:06:33.858Z
- 模式：PRELAUNCH_DEV_AUTONOMOUS
- 結果：PASS
- Writer：主 control-plane
- Browser QA：Codex Terra High

## 產品問題與使用者價值

付款完成後，買家原本只能從 checkout result 確認付款結果，缺少可持續返回的訂單與履約入口。G7-47 沿用既有 `BuyerSupportOrderGrant` capability，加入唯讀訂單清單與明細，讓買家可查看付款、累計退款、實體物流、數位／課程授權與服務進度。

本輪完成：

1. 新增 `/support/orders` 與 `/support/orders/[grantId]`，checkout result 與客服首頁提供可發現入口。
2. capability 以 vendor、order、grant id、token hash、有效期限與撤銷狀態共同綁定；外商家或錯誤 grant 不會顯示訂單。
3. buyer read model 使用明確 Prisma select，只投影遮罩姓名、Email、電話、配送摘要、訂單金額與安全履約欄位。
4. 不投影完整地址、tracking number／URL、付款／退款內部識別碼、`accessEncryptedEnvelope`、`grantSecret` 或其他加密內容。
5. 桌面與手機顯示付款退款摘要、商品 snapshot 與履約狀態；長訂單編號可換行，不造成水平溢位。
6. 新增 loading `aria-busy`／status，頁面維持 noindex 與 private／no-store cache 行為。
7. Browser runner 新增 `--focus-buyer-orders`、雙 RWD 截圖、buyer-orders 狀態與相關 source attestation。
8. runner 外部網路 guard 補齊 socket、HTTP options override、Request-like fetch 與 TLS overload；未知 host fail closed。唯讀安全審查最初指出此 P1，修正後複審為 RESOLVED。

## Source lineage

| 路徑 | SHA-256 |
|---|---|
| `src/lib/buyer-support-access.ts` | `2026c64a1be02f807ea4ff4409fcc32b2bf1b127cdee75fcbde798b5ad51e7a9` |
| `src/lib/buyer-support-access.test.ts` | `15890623127117680daf279e19abea13976e820e1d6d94df6ad36f4d8e58ca80` |
| `src/app/support/orders/page.tsx` | `5263507f132427e0300daee082dbcb2476a3be0d3f027c741b7bfdbddcf324b2` |
| `src/app/support/orders/page.test.tsx` | `6b170b9e8cb0941133051a76e4371e432c4bd9ef047874630c5c41dc0a59161f` |
| `src/app/support/orders/loading.tsx` | `32255d529b9f6bda23521de820dab954298247c6a4b40d96d92dedc890d7f291` |
| `src/app/support/orders/[grantId]/page.tsx` | `8cbe669210d7869872eadc96cc998938774770ee4e438a35a22a818bcc46ffa2` |
| `src/app/support/orders/[grantId]/page.test.tsx` | `6c5ecf624c93fdb7ed2b8152f47c8461722a13a80346c3c63f8f2c2b7c26e65a` |
| `src/app/checkout/result/page.tsx` | `f4039218660121362d6dc2e792282b8ccc75b7740e5b5d3b7b22b2a96db35029` |
| `src/app/checkout/result/page.test.tsx` | `750f1051288543943db6b5f6087fe5656cd0572f1c9cd0f500759d562df13938` |
| `src/app/support/page.tsx` | `568c408c455428a36552978f2b96814f6e48a480e0ebf1ae1fcb7d16e61e9288` |
| `src/app/support/page.test.tsx` | `bc86d01b8f25cfb4a555caa4f4cdefdd8b36722ff1b0cc611a73be1888b0c067` |
| `tests/e2e/commerce-orders.spec.ts` | `7b691a6f1a16f189b1e3f38664f78e113d6974dcf9b5f912a27a0c815b37110b` |
| `scripts/g7-commerce-browser-qa.mjs` | `8aad0127db73734dad8e24af89c75233754b4908624f0d0e1d5835f12873bf1f` |
| `scripts/g7-commerce-browser-qa.test.mjs` | `5009af2a2817accdfe7f1a6fdca5af63dea39b10649f522cb3c2bd2628fdeec3` |

## Deterministic 與 Browser 證據

### PASS

- `npx vitest run "src/lib/buyer-support-access.test.ts" "src/app/support/orders/page.test.tsx" "src/app/support/orders/[grantId]/page.test.tsx" "src/app/checkout/result/page.test.tsx" "src/app/support/page.test.tsx"`
  - 5 files、21 tests PASS。
- `node --test scripts/g7-commerce-browser-qa.test.mjs`
  - 16/16 PASS，包含 focused contract、雙截圖要求、失敗分類與 network guard overload probes。
- scoped ESLint：exit code 0。
- `npm run typecheck`：exit code 0。
- scoped `git diff --check`：exit code 0。
- Terra High：`node scripts/g7-commerce-browser-qa.mjs --focus-buyer-orders`
  - receipt：`docs/ai-team/evidence/g7-47-buyer-orders-browser-qa-29abaffadb2b9a92.json`
  - receipt SHA-256：`bb1955ce4e54d9fec32a67adc50c1e6b5461536a16ebb1a69245bc2cfedf80dd`
  - production Next build PASS。
  - Prisma generate／validate／50 migrations／status PASS。
  - Browser 1/1 PASS、0 failed、0 skipped。
  - Axe critical/serious = 0；RWD、tenant isolation、PII envelope leak、buyer orders 全部 PASS。
  - server、精確 ownership container、temp root cleanup 全部 PASS。
  - `dotenvContentsRead=false`、`externalOperations=false`、`productionOperations=false`。
  - 桌面截圖：`g7-04-browser-qa-29abaffadb2b9a92-screenshots/buyer-orders-desktop.png`，SHA-256 `fb01fc2989817e92074242c194e320cb79cf0d402ff668524b7db6d8119a6b8a`。
  - 行動截圖：`g7-04-browser-qa-29abaffadb2b9a92-screenshots/buyer-orders-mobile.png`，SHA-256 `bf714b063c7a0faac52a6733cc7048e7f117b6e79b609f1350225a95dcb124ea`。
  - 主 control-plane 已視覺檢查兩張截圖：桌面資訊階層完整；手機長訂單編號正常換行、卡片單欄排列、連結與 footer 未截斷。

### 如實保留的失敗與修正

| Receipt | 結果 | 後續修正 |
|---|---|---|
| `g7-47-buyer-orders-browser-qa-6b4025f9c7842d41.json`，SHA-256 `291c7a7a90327272e251650ed18855e5220347e5dc7ae0b9c74fec33533db9d2` | Browser FAIL，訂單清單 locator 過度依賴 exact text | 改成 scope 明確且驗證 foreign order 不存在的 locator |
| `g7-47-buyer-orders-browser-qa-1da062f1b726b45f.json`，SHA-256 `cc160d588ef07c85b7137c05866570ddc4a512025254f01e26b3c421d2c5ec1c` | Browser FAIL，`等待處理` 同時命中 badge 與 definition | 限定在「商品與履約進度」region 的 definition |
| `g7-47-buyer-orders-browser-qa-c014b2e454e7e81a.json`，SHA-256 `a8f90dc51c06c7fc4071ac8f665d315935a96343e2ef7b7fe09a3b86170c5630` | Axe serious color-contrast FAIL | 安全提示文字由 `text-slate-500` 調整為 `text-slate-600` 並補回歸 assertion |
| `g7-47-buyer-orders-browser-qa-242fdd9e9d6d15ba.json`，SHA-256 `57f5c47f722707ad1800d4dd986c3668381af9fee6664f9a1b48612081d7b8e6` | 手機長訂單編號造成 155px 水平溢位 | flex child 加入 `min-w-0 max-w-full`，heading 允許 anywhere wrap；手機截圖改在 assertion 前保存 |

上述 FAIL 沒有被改列 PASS；每次 source 修正後才建立新的 receipt。

## 計分與剩餘缺口

- `orders_fulfillment` 具資格由 8.5 提升為 8.7：core 2.7 → 2.8、UX 1.5 → 1.6。
- canonical CAT01～CAT10 維持 74；CAT04=6、CAT10=4.5。本輪沒有新的 PayUni Sandbox／staging 或真人簽核證據。
- Goal 維持 ACTIVE。
- G7-47 不需要使用者手動處理。
- 尚未完成：
  - grant 缺少 buyer-facing 主動撤銷／安全重發流程，既有有效期為 180 日。
  - 數位商品／課程只有 opaque entitlement 狀態，尚無商家可設定、買家可實際取得的內容。
  - 服務商品只有排程狀態，尚無商家交付指引。
  - POSIX server cleanup helper 的 immediate-return 為 P2；目前 Windows 路徑與本輪 cleanup 全 PASS。

## Ownership 與回滾

- 接管範圍限於上表 G7-47 source、tests、Browser runner hunks、本 evidence、receipts、截圖與 scorecard 更新。
- 未修改 Prisma schema或 migration，未操作外部／正式服務，未 commit、push、merge 或 deploy。
- 回滾時只移除 buyer order list/detail、checkout／support 入口、safe projection、G7-47 tests／runner flag／evidence；不得回滾既有 checkout capability、商家訂單、付款、退款、履約或其他 dirty worktree 變更。

## 下一個最高價值工作

G7-48：補齊 digital／course／service 的實際交付設定與 buyer delivery。商品需能安全設定交付內容，建單時建立不可變 snapshot，付款後由 order-bound buyer capability 取得自己的可用 CTA 或服務指引；不得把交付 secret、內部 provider id、完整 PII 或任意未驗證 URL 放入公開 HTML、事件或 query string。既有訂單維持 legacy read path。
