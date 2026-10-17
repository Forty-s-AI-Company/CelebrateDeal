# WP-20 入口來源封存

狀態：IN_PROGRESS；WP-20 NOT_READY，完整 Goal 保留。此子項建立來源 INSERT frontier，不宣稱完整 request universe、epoch 或正向 coverage。

## 改動與不變條件

129 migration 新增 private LiveMetricIngressSeal 與 immutable guard；Prisma schema 增加相同關聯；live-metric-ingress-seal.ts 提供嚴格 scope 的私有 helper，沒有公開 route 或自動啟用入口。run 必須先停止且沒有 pending frame，才能封存。中斷、未配對與非200請求仍保留，不因封存消失或變成成功。

封存與來源 predicate 都使用 version SHARE → run 鎖順序。來源持有 run SHARE 到交易提交，封存取得 run UPDATE 後才讀取計數；封存提交後的新來源會看到 seal 並拒絕。資料庫 trigger 同時保護直接 trusted SQL。sealedAt、frame/page/playback counters 由 DB clock／實際表格推導，不能由呼叫端偽造；重試 helper 回傳同一 seal，不重開 run、不變更 sealedAt。

這個 frontier 只禁止後續 LiveMetricVisitPage／LiveMetricPlaybackIntake INSERT。它不凍結 lossAt、visits、intents、sessions 或 playback receipts，也不取代 registration/order 的完整性證據。沒有把來源筆數當成訪客數或觀看時長；125 禁止 unsupported covered visits/viewing 的 gate 完整保留。

## 驗證與限制

當前 source hashes、各檢查結果見 coverage/ingress-seal-db.json 及 ingress-seal-validation.json。129 migrations、14 項真實 DB 檢查通過，包括實際 source transaction 阻擋封存、封存阻擋晚到 raw INSERT 並於提交後拒絕、有效未使用 playback frame 封存前允許/後拒絕、未停止/pending 拒絕、保留缺漏、immutable/no truncate、counter/time 推導、跨 scope、table/function ACL 與 canonical cascade。container/tempRoot cleanup PASS。

測試使用 owner runtime；NOLOGIN untrusted role 實際被拒絕，不能擴張成 deployed minimum runtime role 驗證。播放案例驗證 private binding predicate，不宣稱完整媒體／觀眾 admission E2E。新 seal helper 尚未接到實際 Next runner 的最終封存階段；前輪 Next 瀏覽器收據為128 migration snapshot，不能當129整包驗收。

刻意保留 owned disposable marker gate，與127 run建立的非正式限制一致；資料庫 comment 不是授權或 ownership 證明，實際 ownership 仍由 canonical runner 檢查容器、loopback、marker 與清理身份。缺 marker 時拒絕建立 seal，既有來源 predicate 的 no-run legacy 行為保持；不宣稱這個限制適用正式部署或自動取得正式授權。這是獨立深度複審仍保留的 MINOR。

原始 review、followup 與 source hashes 另存，當前 migration/helper 送審範圍無 BLOCKER/MAJOR；actual provider Claude CLI，observed claude-opus-5-5，effort unknown。函式 ACL 複審建議已補顯式 revoke，實際 NOLOGIN role/精確單一 signature 拒絕通過。整個 harness 沒有在該 scoped review 內，不宣稱全文經外部審查。

## 失敗紀錄

首次 runner 未保存 callback 主錯誤，只顯示 main.status assertion；已加入固定 name/code/SQLSTATE/行號分類，未保存 raw logs 或值。第二次確認 runner 錯把含 admittedAt 的 admission 回傳值交給 strict settlement scope，Zod 正確拒絕；改成明確 run/frameId 後通過。另有一次相同報名頁 helper 回傳 null 的間歇失敗，原因未確認。加入交易層固定分類觀測後，完整14案例通過；後續PASS不能證明間歇問題已修好。所有FAIL及前次PASS另存，不刪除或降低assertion。

## Ownership、風險與回滾

root 唯一 writer，external reviewer 唯讀依序；requested/effective ai-team-pro，router 建議 Sol/xhigh，root observed model/effort unknown，depth1/parallel1/automatic_spawn=false。所有變更位於獨立 worktree C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal，base efb8b7e9；原 dirty 工作樹未操作，沒有 commit/push/deploy 或正式 DB／付款／寄信。

遇到 pending、scope/marker/clock 不符或等待逾時時停止封存並回報，不把它改成成功，不刪 frame/source 或強迫 settlement。仍開啟 public quota／永久loss／鎖競爭／metrics失敗影響表單的 MAJOR，以及舊 SSI7/13 與間歇失敗。來源 seal 本身不能解除它們。

回滾先停用 owned 非正式 collection，停止 gateway/受控 app，不再注入 profile；保留 seal/frame/source/gap 與既有 migrations。不能解封同一版本、逆向 migration、刪資料、降 revision 或復活舊 cache。沒有 Production 執行授權。

下一步：把封存接入實際 Next/browser 流程，再補全入口/最小 role、真正 source epoch 與 typed positive visits/viewing producers，最後驗收五項完整非零M1/M2。完成WP維持01/05/06/07/08/10/11/15，8/20（40%）；D2～D6依賴項WAITING_AUTHORIZATION並跳過。
