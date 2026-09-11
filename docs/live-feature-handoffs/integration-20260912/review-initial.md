已完整讀取 558 行檔案快照。進行逐項審查。
已完整讀取 558 行快照，審查完畢，判定如下：

---

## 判定：**需修（2 項必要修復）**

### ✅ 確認正確的 4 個設計點

| 設計點 | 結論 |
|---|---|
| FOR SHARE 阻擋 FOR UPDATE | ✅ 正確。PostgreSQL 鎖相容矩陣保證，`lockedState(reading=true)` 用 FOR SHARE，持有期間所有 FOR UPDATE（commandCard / setDanmaku / commandWarmup）必須排隊等待 |
| DB clock cursor 不越過未 commit | ✅ 正確。`answerCard` 在 FOR UPDATE 持有後才取 `clock_timestamp()`，`readDanmaku` 的 FOR SHARE 確保它等到 commit 後才能前進，cursor ≥ committed createdAt |
| 舊 FOR UPDATE reader 測試失敗 | ✅ 符合預期。Case 3 的 2 秒 race 斷言：舊版兩讀者互擋超時 → `false` → 失敗；修復後 FOR SHARE 讀讀共享 → `true` → 通過 |
| Media cleanup stop 路徑 | ✅ `stopRemote()` 使用獨立 `AbortSignal.timeout(5000)`（非 lifetime signal），`keepalive: true`，頁面卸載後仍能送達 |

---

### ⚠️ Fix-1：`readDanmaku` 缺少 `RepeatableRead`（中風險，**必須修**）

**位置**：[`live-danmaku.ts` L31](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md#L31)

Prisma 預設 READ COMMITTED。FOR SHARE 阻擋 FOR UPDATE，但 `findMany`（L41–46）執行時不在 FOR SHARE 保護的快照內，可能讀到競爭 commit，使 cursor 邊界產生窗口。

對照 `viewerCardSnapshot`（[L162](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md#L162)）已正確加上 `RepeatableRead`。

**修復**：
```ts
return db.$transaction(async tx => { ... },
  { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
```

---

### ⚠️ Fix-2：Polling 逾時可觸發雙重 `onInvalidate(true)`（低風險，**建議修**）

**位置**：[`interaction-card-polling.ts` L521–537](file:///C:/Users/eden/Downloads/AI/CelebrateDeal/tmp/live-integration-20260912/review/post-fix.md#L521)

可達序列：fetch 在第 3.9 秒收到 response 正在解析 body → 4 秒計時器觸發 `cancel()` abort → body 讀取拋 AbortError → catch 再呼叫一次 `onInvalidate(true)`。單次請求觸發兩次失效通知，可能導致 UI 雙重重置。

**修復**：`catch` 加防衛條件：
```ts
} catch { if (active && sequence === revision && pending === current) callbacks.onInvalidate(true); }
```

---

3 項觀察（`readWarmup` 在 FOR SHARE 內查腳本資料表、media 伺服器端 GC、`manualCardAllowed` 跳過路徑）均無法從快照直接確認為 bug，不宣稱修復。

詳細推理見 [review-report.md](file:///C:/Users/eden/.gemini/antigravity-cli/brain/c3d307bd-099e-4171-bded-24adc93341fd/review-report.md)。
