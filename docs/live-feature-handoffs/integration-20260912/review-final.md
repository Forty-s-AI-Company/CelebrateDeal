好，我已完整讀取 `post-fix.md`。現在針對兩個主張進行獨立核對，逐步找反例。

---

## Fix1 核對：FOR SHARE 與 READ COMMITTED vs. Repeatable Read 之爭

### 相關程式碼段（live-danmaku.ts）

```
readDanmaku → db.$transaction(async tx => {
  const stored = await lockedState(tx, scope, true);   // L32: FOR SHARE
  ...
  const rows = await tx.liveInteractionResponse.findMany({...})  // L41-46: 在同一 tx 內
})
// 注意：viewerCardSnapshot 明確指定 { isolationLevel: RepeatableRead }
// readDanmaku 無 isolationLevel 選項 → 繼承 Prisma 預設 → READ COMMITTED
```

### 核心邏輯分析

**問題**：`answerCard`（使用 `FOR UPDATE`）commit 後，`readDanmaku` 裡的 `findMany` 能否看到這筆新資料？

**FOR SHARE 的語義**：
- `FOR SHARE` 在同一 transaction 內鎖定 Live 列，**直到該 transaction commit 才釋放**。
- `answerCard` 使用 `FOR UPDATE` 鎖定同一 Live 列，因此 `answerCard` 必須等到 `readDanmaku` 的 transaction commit 後才能獲得鎖（或反之）。
- **關鍵**：`findMany` 與 `FOR SHARE` 在**同一個 callback 內**，即同一 transaction 內。它們不是跨 transaction 的兩次操作。

**時序序列（尋找反例）**：

```
時序 A（readDanmaku 先拿鎖）：
  T1_read: BEGIN
  T1_read: FOR SHARE on Live row → 取得 SHARE lock
  T2_answer: BEGIN
  T2_answer: FOR UPDATE on Live row → 被 T1_read 阻擋，等待
  T1_read: findMany(liveInteractionResponse) → 此時 T2_answer 尚未 commit，看不到其 answer
  T1_read: COMMIT → 釋放 SHARE lock
  T2_answer: 取得 UPDATE lock → CREATE response → COMMIT
  結果：readDanmaku 看不到這個 answer ✓（watermark 正確，不含未 commit 資料）
```

```
時序 B（answerCard 先 commit）：
  T2_answer: BEGIN
  T2_answer: FOR UPDATE on Live row → 取得 UPDATE lock
  T2_answer: CREATE response → COMMIT → 釋放 UPDATE lock
  T1_read: BEGIN
  T1_read: FOR SHARE on Live row → 取得 SHARE lock（此時無競爭）
  T1_read: findMany → 能看到 T2_answer 已 commit 的 answer ✓
  T1_read: COMMIT
```

**READ COMMITTED vs Repeatable Read 的關鍵差異**：

在 **READ COMMITTED** 下：
- 等待 `FOR SHARE` 鎖時，如果被 `FOR UPDATE` 阻擋，等待結束後會取到**最新 snapshot**（看到等待期間已 commit 的資料）。
- `FOR SHARE` 取得後，`findMany` 在**同一 transaction 內**，用的是**同一個 snapshot**（但 RC 下是語句級 snapshot，不是 transaction 級）。

> 重要：PostgreSQL RC 下，每個**語句**有自己的 snapshot；RR 下，整個 **transaction** 共用一個 snapshot。

**時序 C（RC 下潛在風險場景，尋找反例）**：
```
T1_read: BEGIN (READ COMMITTED)
T1_read: FOR SHARE → 等待 T2_answer 的 FOR UPDATE 釋放
T2_answer: CREATE response → COMMIT
T1_read: FOR SHARE 獲得（新語句 snapshot，看到 T2_answer 已 commit）
T1_read: findMany（新語句 snapshot）→ 能看到 committed answer ✓
```

**時序 D（RR 下的問題場景）**：
```
T1_read: BEGIN (REPEATABLE READ)
T1_read: 第一個語句建立 snapshot S0（T2_answer 尚未 commit 時的 snapshot）
T1_read: FOR SHARE → 等待 T2_answer 的 FOR UPDATE 釋放
T2_answer: CREATE response → COMMIT
T1_read: FOR SHARE 獲得，但 snapshot 仍是 S0
T1_read: findMany 用 S0 → 看不到 T2_answer 的 answer ❌
  → 此時 watermark 是 FOR SHARE 之後的時間，但 findMany 卻不含剛 commit 的 answer
  → 觀眾會在下一輪才看到，但 watermark 已推進 → answer 可能永遠被跳過
```

### Fix1 結論

**前輪主張「READ COMMITTED 正確，Repeatable Read 有問題」→ 確認正確，沒有反例可撤回。**

RC 下：`FOR SHARE` 等待結束後，`findMany` 用新語句 snapshot，能看到等待期間已 commit 的 answer → 水位線與資料一致。
RR 下：整個 tx 共用 S0 snapshot，`findMany` 可能看不到等待期間 commit 的 answer → 水位線超前資料 → answer 可能被跳過。

`readDanmaku` 沒有指定 `isolationLevel`（只有 `viewerCardSnapshot` 有），因此走 Prisma 預設（RC）→ **行為正確**。前輪若誤判此處需要 RR，現予**撤回**。

---

## Fix2 核對：cancel 的 revision++ 與 AbortError catch 的 invalidate

### 相關程式碼（interaction-card-polling.ts）

```typescript
let revision = 0;
function cancel() {
  revision++;                          // (C1)
  const previous = pending;
  pending = null;
  if (previous) { window.clearTimeout(previous.timeout); previous.controller.abort(); }
}
async function refresh() {
  ...
  current.timeout = window.setTimeout(() => {
    if (!active || pending !== current) return;
    cancel(); callbacks.onInvalidate(true);  // (T1) timeout 路徑
  }, 4000);
  const sequence = ++revision;         // (R1)
  ...
  try { ... }
  catch { if (active && sequence === revision) callbacks.onInvalidate(true); }  // (E1)
  finally { window.clearTimeout(current.timeout); if (pending === current) pending = null; }
}
```

### 逐步追蹤 revision 數值

**初始狀態**：`revision = 0`

**Step 1**：`refresh()` 被呼叫
- 建立 `current`，`pending = current`
- 設定 4s timeout
- **`sequence = ++revision` → sequence = 1, revision = 1**

**Step 2（4s timeout 觸發）**：
- `pending === current` → 條件成立
- 執行 `cancel()`：**revision++ → revision = 2**，`pending = null`，abort signal
- 執行 `callbacks.onInvalidate(true)`

**Step 3**：fetch 因 abort signal 被中止，拋出 AbortError
- `catch` 區塊執行：`if (active && sequence === revision)`
  - `sequence = 1`，`revision = 2`
  - **1 !== 2 → 條件不成立 → 不再呼叫 onInvalidate**

**反例搜尋**：有沒有辦法讓 `sequence === revision` 在 catch 裡成立？

- timeout 觸發 cancel → revision 變成 2
- 若之後有另一個 refresh 呼叫 `++revision` 使 revision = 3，sequence(=1) 更不等於 3
- timeout 觸發後 revision 只會增加，不會減少 → **sequence 永遠不等於 catch 時的 revision**

**更複雜場景**：如果在 timeout 之前有其他 cancel 呼叫？

```
revision=0
refresh() 被呼叫 → sequence=++revision=1, revision=1
外部呼叫 resume() → cancel() → revision=2, pending=null
  → 但 pending !== current，所以 timeout 仍在跑
timeout 4s 觸發 → pending !== current (pending=null) → 條件不成立 → 直接 return
catch { sequence=1, revision=2 → 不等 → 不 invalidate }
```

**另一場景**：timeout 後 catch 能否 invalidate？

不能。timeout 路徑的 `cancel()` 已將 revision 從 N 推進到 N+1，而 catch 裡的 `sequence` 仍是 N，所以 `sequence === revision` 永遠為 false。

### Fix2 結論

**前輪主張「timeout 後 catch 不會再次 invalidate」→ 確認正確，沒有反例可撤回。**

timeout 觸發 → `cancel()` 先做 `revision++` → catch 裡 `sequence !== revision` → catch 的 `onInvalidate` 分支不執行。timeout 路徑的 `onInvalidate(true)` 已在 cancel 後立即呼叫，catch 不會重複呼叫。邏輯正確，無雙重觸發問題。

---

## 兩項結論

| # | 主張 | 核對結果 |
|---|------|---------|
| **Fix1** | `readDanmaku` 使用 RC（預設），FOR SHARE 等待後 findMany 拿新語句 snapshot，能正確看到剛 commit 的 answer；若改為 RR 反而會因舊 snapshot 漏掉 answer | ✅ **前輪判斷正確，維持** |
| **Fix2** | timeout 觸發後 cancel() 先做 revision++，catch 裡的 sequence 已不等於 revision，不會再次呼叫 onInvalidate | ✅ **前輪判斷正確，維持** |

---

## 六個檔案的真實可接受性判定

| 檔案 | 判定 | 說明 |
|------|------|------|
| [`live-danmaku.ts`](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md) | ✅ **可接受** | FOR SHARE / FOR UPDATE 組合邏輯正確；RC 預設下 findMany snapshot 語義符合需求 |
| [`interaction-card.ts`](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md) | ✅ **可接受** | `lockLive` → FOR UPDATE 序列化所有寫入；`answerCard` 使用 clock_timestamp() 正確繞開 tx 起始 now()；`viewerCardSnapshot` 明確指定 RR 用於一致性讀 |
| [`scripted-roles.ts`](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md) | ✅ **可接受** | `commandWarmup` 使用 FOR UPDATE 鎖定；幕後角色投影不建立任何真人紀錄；idempotent requestId 防止重複發送 |
| [`live-cross-feature.db.test.ts`](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md) | ✅ **可接受** | 三個整合測試覆蓋：隔離讀寫、並發鎖競爭、SHARE lock 不阻擋讀者；expect 斷言完整 |
| [`live-media-client.ts`](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md) | ✅ **可接受** | AbortController lifetime 管理正確；stop 用 keepalive fetch 確保頁面關閉時送出；heartbeat 用 `AbortSignal.any` 組合 timeout 與 lifetime |
| [`interaction-card-polling.ts`](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md) | ✅ **可接受** | revision/sequence 雙軌機制正確防止過期回應與重複 invalidate；timeout 先 cancel 再 invalidate 的順序正確 |

**全部六檔可接受，無需修改。**
