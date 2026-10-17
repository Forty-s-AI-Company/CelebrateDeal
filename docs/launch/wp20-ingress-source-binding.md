# WP-20：入口與頁面／播放來源綁定

狀態：IN_PROGRESS；WP-20 NOT_READY。這是已核准 M1/M2 的來源接線，五項統計的完整非零驗收仍未完成。

## 本輪成果

新增 128 migration、nullable ingressFrameId、private SQL predicate 與 source guard。run-owned 版本的來源必須對應同一 tenant/live/version/run 的已記錄 frame，且種類正確；同一 frame 只能使用一次。原有未知歷史不補登、不重分類。source 與 frame 的 FK 延後檢查，允許 canonical 版本 cascade；個別 frame/run/source 的刪除與 TRUNCATE 仍禁止。

gateway 可注入每個 run 的 HMAC 簽署標頭，涵蓋 frame、scope、來源種類、method 與精確 target。先提交 admission 才轉送；移除客戶端偽造的內部／forwarded 標頭，再保留已驗證的 Host、Origin、Fetch-Site。回應不傳回內部標頭。金鑰僅由 owned runner 在記憶體／已知 process environment 注入，不讀取 env 檔案或 Secret Store。

`/form/[slug]`、兩種 `/lp` 路由、觀看頁及播放 API 已加入伺服器端綁定接線；method/target/kind 從實際 route 決定。這個標頭不取代觀眾授權、同源檢查、rate limit、表單驗證或版本判斷。

來源函式在 canonical locks 後呼叫同一 SQL predicate。缺少／過期／錯誤 scope／已使用的 frame 回傳明確的 null，不寫入來源；原始 SQL 仍受 trigger 與 unique constraints 保護。兩個不同觀眾 admission 並行使用同一 frame 時，由 frame FOR UPDATE 序列化，恰好一筆成功，另一筆回 null。基礎設施錯誤不會偽裝成 null 或 PASS。

## 驗證範圍

精確當前 source hashes 以 `coverage/ingress-binding-validation.json`、`ingress-binding-db.json` 為準。預定交付的本輪驗證為 113 項 targeted units、lint、完整 typecheck、128 migration 與 19 項 disposable DB／HTTP 檢查；只有匹配並實際完成的收據才能稱 PASS。

HTTP harness 使用當次建立的 owned loopback upstream，實際呼叫報名頁／觀看頁 issuance 與 canonical 播放來源函式；也呼叫既有 `requireSameOriginRequest`，驗證 spoofed forwarded 與 Connection 無法改掉已驗證的 origin。它不是完整 Next dev server、瀏覽器 JS、cookie 登入或播放器 E2E。Next entry 的 signed-header 接線由 targeted unit tests 驗證，不能擴張成 Next runtime PASS。

DB cases 包含：真實 guard 順序、private predicate／無權角色拒絕、未綁定 null、錯誤種類 raw SQL 拒絕、三種實際 source 綁定、跨 scope query 拒絕、綁定不能取代觀眾授權、停止後 null、永久不可改綁定、不同 admissions 並行單次使用、停用收集的 context race、run 建立與 source 等待競爭、legacy no-run，以及完整版本 cascade。測試使用 owner runtime connection，已檢查它與 migration function owner 相同；不認證部署環境的其他 runtime role。

## 複審與剩餘限制

requested/effective team：ai-team-pro；router 依 signals 選擇 gpt-6.1-sol/max，主對話實際 observed model/effort unknown。獨立 Migration/Auth/Permission review 分 proof、source、entry，唯讀且依序執行；實際 provider/model/effort 與 fallback 依原收據記錄。原 findings 不改寫，修正與精確複審另存。

審查輸入安全檢查曾拒絕憑證宣告程式行。guard 保持啟用，送審文本明確省略那些行並標示範圍；沒有傳送真實憑證，也不宣稱省略行經獨立審查。source 最終複審附上當前 INSERT：它們在本輪較早階段就已帶 ingressFrameId；不能把本輪內部 baseline 誤當 origin/master 而判斷欄位不存在。

仍未完成：受控完整 Next startup 與最小權限 runtime、完整允許入口／RSC／attribution query／alias 規則、來源 epoch、停止後 writer fence、typed 正向 visits/viewing producer、完整五項非零整合與負載。125 禁止 unsupported covered 的 gate 完整保留。

HMAC 目前沒有獨立 expiry，必須經 DB lifetime/context 與單次 source 寫入判斷，不能把驗簽成功當成來源完整。停止 admission 不代表來源封存；已 admission 的有效 frame 仍可完成來源寫入。精確 target 不做寬鬆 alias 正規化；非 canonical 或未列出的路徑保守拒絕。沒有 tracking scope/keyring 的頁面可能略過驗簽、留下未綁定來源；完整 startup/closure gate 尚未建立，不能因此宣稱 covered。部分 integrity failures 保留 generic persistence 分類，不作成功或完整性的依據。

既有公開 SSR lifetime quota／永久 loss／鎖競爭／metrics 失敗影響表單 MAJOR 尚未解除。舊 SSI 7 成功 13 失敗與早先偶發測試失敗不宣稱修復。

本輪也保留初次 run-creation race 的觀測失敗，以及一次 signed-http／停止失敗：前者換用即時 pg_locks/pg_blocking_pids 後實際觀測到等待並通過，但舊統計觀測失敗不冒充產品 race 缺陷已被重現；後者最初被 shutdown error 蓋過主要錯誤，根因仍未知。新增安全的分類診斷，且 finally 即使 stop 失敗仍關閉 owned upstream；後續 PASS 不能證明舊偶發失敗已修好。

## Ownership、回滾與 handoff

唯一 writer：root。所有變更在 `C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal`，基底 efb8b7e9；原 dirty 工作樹未操作。沒有 commit、push、部署或正式 DB／付款／寄信。

回滾先對 owned 非正式版本停用 collection，再停止 gateway 與受控 app，重啟時不注入 ingress profile。保留既有表、來源、frame、缺漏與 125 gate；不逆向 migration、不清除未知資料、不降低 revision 或復活舊 cache。只移除本輪接線不能讓 run-owned 版本重新接受未綁定來源。

evidence 根目錄：`docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/`。主要檔案：`ingress-binding-{route,validation,db,checkpoint,changed-files}.json`；proof/source/entry 各 review 與 source snapshots；`ingress-binding-defined-result-baseline.json`、`ingress-binding-defined-diff.json`；初始敏感輸入拒絕、race、HTTP 失敗及 failure disposition。

Goal 維持 8/20（40%），完成 01／05／06／07／08／10／11／15；D2～D6 依賴 WP 保留 WAITING_AUTHORIZATION，沒有把 WP-20 標成完成。下一步是受控 Next runtime 與完整來源封存／正向 producer，再驗收 40%、60%、66.67%、83.33 秒、50% 的非零案例；7 天只用於完看後訂單資格。
