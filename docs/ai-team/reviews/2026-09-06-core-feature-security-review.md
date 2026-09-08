# 近期核心功能 Code Review 與安全性檢驗

- 審查分支：`origin/codex/one-stop-webinar-flow`
- 審查 HEAD：`13031852e46d287d2b15f2e744e60c7bbe768eed`
- 重點 commits：`14768cc`、`1303185`
- 審查日期：2026-09-06（Asia/Taipei）
- 審查機制：ai-team 高階模式；主代理檢查 + 獨立唯讀 Reviewer（Terra high）
- 最終判定：**BLOCK**

## 摘要

目前不能把 ECPay 與「已購課限定抽獎／兌獎」視為可上線完成。共有 5 個上線前必修問題：

1. Critical：Production 缺少 ECPay Secret 時會回退到公開測試金鑰。
2. Critical：送往 ECPay 的 20 碼交易編號會截斷站內訂單號，成功回呼無法回綁原交易。
3. High：`queryPayment` 沒有呼叫 ECPay 查單 API，只回傳本機資料。
4. High：`purchased` 抽獎資格未在後端驗證，任何已入場觀眾皆可登記。
5. High：畫面上的兌獎碼由公開 run ID 推導，任何觀眾都能算出，且後端沒有核銷驗證。

另有 2 個 Medium 問題：無直播商品時成交跑馬燈會查出該商家所有近期訂單；輪播計時器會因每 6 秒重設陣列而幾乎無法前進。

## 檢核矩陣

| 檢核項目 | 結果 | 證據 |
|---|---|---|
| CheckMacValue .NET URL encode、lowercase、SHA256、uppercase | PASS | `ecpay.ts:53-75`；官方向量得到 `6C51C9E6...B5685B840` |
| 簽章時序安全比較 | PASS | `ecpay.ts:174-177` 使用 `timingSafeEqual` 並先檢查長度 |
| ECPay notify 回純文字 `1\|OK` / HTTP 200 | PASS | `payments/route.ts:100-102` |
| pending → paid/failed 狀態單調性與會計交易原子性 | CONDITIONAL PASS | serializable transaction 與 webhook event CAS 存在；但 ECPay 訂單識別截斷使真實回呼無法套用到原交易 |
| 重複 webhook 防重放 | PASS（同 eventId） | `WebhookEvent @@unique([provider,eventId])`、processed fast path、serializable retry |
| 成交廣播不回傳電話／地址／Email | PASS | route 僅 select `id`、`buyerMaskedName`、`paidAt`、`productName` |
| 姓名遮罩 | PASS（資料最小化仍可加強） | DB 已保存遮罩姓名，route 再執行 `maskCustomerName` |
| 全體觀眾資格 | PASS | 必須有 active viewer session，且每 run/participantHash 唯一 |
| 留言通關密語資格 | PASS | `live-interactions/route.ts:217-220` 由後端比對 slogan |
| 已完成購課資格 | FAIL | purchased 模式沒有任何 paid order / entitlement / verified identity 查詢 |
| 排除歷史中獎者 | PASS | 以同 vendor/live 的歷史 winner response participantHash 排除，抽獎 updateMany CAS |
| 8 碼兌獎碼生成與驗證 | FAIL | UI 顯示 `CD-${run.id.slice(-6)}`，無隨機碼、Hash、後端驗證或核銷狀態 |
| React 計時器 unmount cleanup | PASS | 所有已建立 interval/timeout 均在 effect cleanup 清除 |

## 阻斷發現

### CD-SEC-001 — Production 回退公開 ECPay 測試金鑰（Critical）

位置：`src/lib/payment-providers/ecpay.ts:12-36,115-118,168-177`

`ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV` 缺失時，不分環境都使用綠界公開測試值。當 `NODE_ENV=production` 且 `ECPAY_ENV=production` 但漏設任一 Secret，`checkoutReadiness()` 仍回 `ready`，webhook 也會用公開金鑰驗簽。

攻擊者可用公開測試 HashKey/IV 對自己的未付款訂單構造有效 `RtnCode=1` 通知。因 webhook 接受簽章後會推進付款、庫存及履約，這是可直接造成未付款出貨／授課的漏洞。

最小修補：

```diff
 export function getEcpayConfig() {
   const isProduction = process.env.NODE_ENV === "production" && process.env.ECPAY_ENV === "production";
-  const merchantId = process.env.ECPAY_MERCHANT_ID?.trim() || DEFAULT_ECPAY_MERCHANT_ID;
-  const hashKey = process.env.ECPAY_HASH_KEY?.trim() || DEFAULT_ECPAY_HASH_KEY;
-  const hashIv = process.env.ECPAY_HASH_IV?.trim() || DEFAULT_ECPAY_HASH_IV;
+  const merchantId = process.env.ECPAY_MERCHANT_ID?.trim()
+    || (isProduction ? "" : DEFAULT_ECPAY_MERCHANT_ID);
+  const hashKey = process.env.ECPAY_HASH_KEY?.trim()
+    || (isProduction ? "" : DEFAULT_ECPAY_HASH_KEY);
+  const hashIv = process.env.ECPAY_HASH_IV?.trim()
+    || (isProduction ? "" : DEFAULT_ECPAY_HASH_IV);
   const env = isProduction ? "production" : "sandbox";
   const urls = ECPAY_URLS[env];
-  return { merchantId, hashKey, hashIv, env, urls };
+  const configured = Boolean(merchantId && hashKey && hashIv);
+  return { merchantId, hashKey, hashIv, env, urls, configured };
 }

 checkoutReadiness() {
-  const { merchantId, hashKey, hashIv } = getEcpayConfig();
-  if (!merchantId || !hashKey || !hashIv) return "unavailable";
-  return "ready";
+  return getEcpayConfig().configured ? "ready" : "unavailable";
 },

 async verifySignature(_request, rawBody) {
-  const { hashKey, hashIv } = getEcpayConfig();
+  const { hashKey, hashIv, configured } = getEcpayConfig();
+  if (!configured) return false;
```

`createCheckoutSession` 與 `queryPayment` 也必須在 `configured === false` 時 fail closed，錯誤不可包含設定值。

### CD-SEC-002 — ECPay MerchantTradeNo 截斷造成訂單失聯與碰撞（Critical）

位置：`src/app/api/payments/checkout/route.ts:160-163`、`src/lib/payment-providers/ecpay.ts:125,146,187-188,225`、`src/lib/payment-webhooks.ts:252-257`

站內訂單格式為 `CD-YYYYMMDDHHMMSS-XXXXXX`（24 字元）。adapter 移除 `-` 後仍有 22 字元，再截成 20 字元。例如：

```text
CD-20260907000000-ABC123 -> CD20260907000000ABC1
```

回呼卻優先把被截斷的 `MerchantTradeNo` 當 `payload.orderNumber`。付款核心用這個值查 server-created transaction，必然找不到原訂單；而同秒且亂碼前四碼相同的兩筆訂單還會產生相同 ECPay 編號。

最小修補：以 transaction ID 的 SHA-256 建立穩定、20 碼內的 ECPay reference，並用簽章保護的 `CustomField2` 帶回完整站內 order number：

```diff
+function ecpayMerchantTradeNo(transactionId: string) {
+  return createHash("sha256").update(transactionId).digest("hex").slice(0, 20).toUpperCase();
+}

-const tradeNo = (transaction.orderNumber ?? transaction.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 20);
+const tradeNo = ecpayMerchantTradeNo(transaction.id);
 ...
-CustomField2: transaction.id,
+CustomField2: transaction.orderNumber ?? transaction.id,
 ...
-const orderNumber = rawPayload.MerchantTradeNo || rawPayload.CustomField2 || eventId;
+const orderNumber = rawPayload.CustomField2 || rawPayload.MerchantTradeNo || eventId;
```

必須再加入 callback integration test，證明 checkout 產生的表單經 normalize 後仍取得原始站內 order number，且兩個不同 transaction ID 不會產生相同 MerchantTradeNo。

### CD-SEC-003 — `queryPayment` 偽裝成外部查單（High）

位置：`src/lib/payment-providers/ecpay.ts:223-235`

目前函式完全沒有 `fetch`，只是把本機 transaction 欄位包回 `PaymentQueryResult`，甚至 pending/failed 都會被映射成 `paid`。任何以此結果做 provider reconciliation 的流程都會把「本機相信的狀態」誤當成「綠界已驗證狀態」。

修補要求（不可只改 status mapping）：

1. POST `MerchantID`、`MerchantTradeNo`、`TimeStamp`、`CheckMacValue` 到設定中的 `/Cashier/QueryTradeInfo/V5`。
2. `redirect: "error"`、`AbortSignal.timeout(30_000)`。
3. 解析 form-urlencoded 回應，重新驗證回應 `CheckMacValue`。
4. 交叉比對 `MerchantID`、`MerchantTradeNo`、`TradeNo`（若本機已有）、`TradeAmt`。
5. `TradeStatus !== "1"` 回 `PaymentQueryProviderError("pending" | "provider_response")`，不可合成 paid。
6. QueryTradeInfo 未提供可信的累計退款資訊；本機已存在 refund 時不得用此 API 偽造退款一致性。

在完成前的精確 containment patch 是移除 capability：

```diff
-  async queryPayment(input: QueryPaymentInput): Promise<PaymentQueryResult> {
-    // local projection
-  },
+  // ECPay QueryTradeInfo 尚未完成驗簽與 provider identity binding 前，
+  // 不宣告 queryPayment capability，避免 reconciliation 把本機狀態誤認為外部證據。
```

並移除未使用的 `QueryPaymentInput`、`PaymentQueryResult` imports。這會安全地 fail closed，而非回傳錯誤的付款證據。

### CD-SEC-004 — purchased 抽獎資格可被任意觀眾繞過（High）

位置：`src/components/live-interaction-studio.tsx:73-76`、`src/components/live-advanced-interactions.tsx:206-226`、`src/app/api/live-interactions/route.ts:208-246`

後端只檢查 slogan；`purchased` 與 `all_viewers` 最後都建立同樣的 response。displayName 是使用者自填，不能拿來比對購買人。

完整修補必須建立 server-owned identity binding：verified form submission / authenticated buyer → paid commerce order or entitlement → live product。資格查詢必須與 response create 放在同一個 serializable transaction。沒有這個 binding 前，先 fail closed：

```diff
 if (metadata.kind === "lucky_draw") {
   const isSloganMode = !metadata.eligibility || metadata.eligibility === "slogan";
   if (isSloganMode && data.value !== metadata.slogan) {
     return NextResponse.json({ error: "Draw slogan does not match" }, { status: 400 });
   }
+  if (metadata.eligibility === "purchased") {
+    return NextResponse.json({ error: "Purchased eligibility is not available" }, { status: 403 });
+  }
 }
```

同時先從 Studio 移除 `<option value="purchased">`，直到 identity contract、403/200/重放測試全部完成。禁止以 displayName、遮罩姓名或僅有 viewer token 代替付款身分。

### CD-SEC-005 — 兌獎碼可公開推導且無後端驗證（High）

位置：`src/components/live-advanced-interactions.tsx:188-191`、`src/app/api/live-interactions/route.ts:89-105`

每位觀眾都會收到 run ID；畫面用 `CD-${run.id.slice(-6).toUpperCase()}` 產生碼，因此任何觀眾都能計算同一碼。資料庫沒有 claim-code hash、claimedAt 或核銷記錄，後端也沒有驗證入口。

立即 containment patch：先移除「核銷碼」UI，避免營運人員把它當安全憑證。

完整修補需要：

- 開獎成功時用 CSPRNG 產生恰好 8 碼（建議 Crockford Base32）。
- DB 只保存 HMAC/hash，明碼只透過 winner-bound response 回傳一次。
- 管理端核銷 action 必須重新授權 vendor manager、tenant-scope run/winner，以 `timingSafeEqual` 驗證。
- 以原子 `claimedAt: null -> now` 防止同碼重複核銷，並寫 audit log。
- 測試碼長度／字元集、非 winner 不得取得、錯碼拒絕、首次成功、重放拒絕與跨 tenant 拒絕。

## 非阻斷發現

### CD-SEC-006 — 無 live product 時跨直播廣播全部近期訂單（Medium）

`live-purchase-broadcasts/route.ts:50-52` 在 `productIds.length === 0` 時移除 items filter，等於查詢該 vendor 全部近期 paid orders。應在空清單直接回 `{ broadcasts: [] }`，不可擴大查詢範圍。

### CD-PERF-001 — 成交輪播 timer 被 polling state 重設（Medium）

`live-purchase-ticker.tsx:30-32` 每次 polling 都放入新 array；effect 依賴 `broadcasts`，每 6 秒 cleanup 6.5 秒的 advance timer，因此 index 幾乎不會前進。更新 state 前應比較穩定 DTO（id/name/product/seconds bucket），內容未變時回傳原 array；或拆開 polling 與輪播依賴。

## 已確認安全不變量

- CheckMacValue 實作符合綠界官方 SHA256 與 .NET encode 表，包含 `%2d/%5f/%2e/%21/%2a/%28/%29/%20` 轉換。
- incoming MAC 與 expected MAC 先比長度，再以 `crypto.timingSafeEqual` 比對。
- ECPay notify 的成功路徑為 HTTP 200、body `1|OK`、`content-type: text/plain`。
- 付款核心在 serializable transaction 內重讀 transaction，會計、庫存、履約與 webhook processed CAS 同交易提交。
- `excludePreviousWinners` 使用同 vendor/live 的歷史 winner participantHash，且開獎用 `winnerResponseId: null` compare-and-set。
- `live-advanced-interactions.tsx` 與 `live-purchase-ticker.tsx` 建立的 interval/timeout 均有 cleanup；沒有 unmount timer leak。
- 成交廣播 DTO 未 select Email、電話、地址或 encrypted envelope。

## 自動化驗證證據

| 命令 | 結果 |
|---|---|
| `npm run test:interactions` | PASS；11 files，197 tests |
| `npm run test:contracts` | PASS；919 tests |
| `npm run typecheck:strict-index` | PASS；exit 0 |
| `npm run secret:scan` | PASS；`secret_scan_passed` |
| Targeted 相關測試 | PASS；7 files，120 tests |
| 官方 CheckMacValue known vector | PASS；輸出與官方 `6C51C9E6...B5685B840` 相同 |
| Targeted V8 coverage | 測試本身通過，但 coverage gate FAIL |

Targeted coverage（僅納入本次重點來源檔）：

- Statements：38.95%（342/878）
- Branches：30.35%（251/827）
- Functions：36.00%（54/150）
- Lines：41.72%（320/767）
- 全域門檻：lines 65%、functions 60%、statements 63%、branches 57%；未達標。

coverage 偏低主要來自：

- `live-advanced-interactions.tsx` lines 1.26%
- `live-purchase-ticker.tsx` lines 2.85%
- `interaction-actions.ts` lines 12.15%（該檔包含大量不屬於本次功能的既有 actions）

現有綠燈無法覆蓋本報告的阻斷情境；需新增 production missing config、真實 checkout→callback identity、provider query 驗簽、purchased 403/200、claim redemption 與 timer advancement 測試。

## 上線判定

**BLOCK**。至少 CD-SEC-001～005 完成修補並補齊對應測試前，不應把 ECPay、已購課限定抽獎或兌獎流程標記為 release-ready。
