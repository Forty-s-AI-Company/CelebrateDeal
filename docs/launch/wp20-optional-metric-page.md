# WP-20 統計來源持久化失敗與公開內容隔離

狀態：IN_PROGRESS；WP-20 NOT_READY，完整Goal維持8/20（40%）。本輪修正已確認的公開頁故障子情境，沒有把整個availability MAJOR或五項統計標成完成。

## 行為與範圍

新增optionalMetricPage server helper，只攔截真正MetricVisitorError instance且code為PERSISTENCE_UNAVAILABLE的例外；失敗回null，不渲染統計collector或nonce。form/LP共用的withMetricRegistrationVisit與觀看頁在既有public authorization/readiness和簽署驗證後使用此helper。其他proof/scope/navigation/unknown錯誤，以及只有相同code的普通物件，都繼續拋出。

頁面內容保留原本form/action/欄位與viewer child，沒有建立訪客、補寫成功、重試或發出coverage證書。失敗交易不會憑空變成0筆的完整資料；run-owned ingress仍保留responded但未配對source的frame，legacy no-run仍是unknown。125 unsupported visits/viewing covered gate保持。

失敗會輸出固定事件METRIC_PAGE_OPTIONAL_UNAVAILABLE與固定code PERSISTENCE_UNAVAILABLE。沒有slug、ID、request/DB值、headers、error object/message/stack/cause。其他錯誤不發此事件。它是可觀測訊號，不是完整性證明或保證外部監控已接好。

## 實際驗證

136 targeted units、lint、完整typecheck及兩個新harness的lint通過。包含source commit失敗不外洩nonce、原始form/觀看child保留、proof/scope/ingress/navigation/unknown/lookalike error繼續拒絕、固定事件精確一次且沒有額外payload。既有簽署與權限否定測試保留。

owned mirror執行實際Next與Chromium，129 migrations的disposable PostgreSQL，無產品DB/認證handler mocks。先跑3次正常browser造訪、6次prepare/visit API200、3 visits/1 visitor。之後在owned DB暫裝page source失敗trigger，每次用nextval非交易計數器後RAISE23514，因此可以證明真實DB錯誤發生，不需開啟raw DB logs。

form與viewer各一次故障GET均200。瀏覽器確認form headline、原生POST action、name/email inputs仍在，viewer確認固定live title仍在；DB失敗計數為2，server只分類固定事件2次。source/intent/visit/visitor仍為3/3/3/1，API回應數仍6，沒有假訪客或假事件。

fault trigger/function/sequence在finally移除。gateway drain後實際查得2筆responded200但沒有source的frame，保留這些缺漏。之後沿用pre-seal direct Next control＋late/rawSQL/mutation rollback，最後seal為7frames/4pages/0intake，browser visits仍3、visitor1。兩故障frame、兩刻意interrupted frame不能被當完整coverage。12 runtime checks、owned container/tempRoot/browser/gateway/link cleanup通過，fixed＋bundle inputs pre/post hash一致。

## 複審、React檢查與限制

requested/effective ai-team-pro；router Sol/xhigh，root observed model/effort unknown。獨立readonly Auth/Permission/data review實際Claude CLI claude-opus-5-5、effort unknown；最新followup無BLOCKER/MAJOR/MINOR，保留重複bound/unbound issuer call的maintenance NIT。原始review與findings不改寫。viewer供應lines1-55/126-149，其餘既有authorization/serialization未重供；credential declaration省略行明確標記，不認證整個app。

另依react-best-practices檢查Server/Client boundary、child identity、差異內a11y/serialization/performance/TypeScript，root檢查另存react-review.json，不冒充獨立review。沒有新client hook/state、沒有新增I/O或retry；原本等待metric交易的延遲仍在。

這次只驗證故障時form結構與viewer title，沒有送出真實POST、確認信、付款或媒體播放。browser仍有5次unknown auxiliary abort、4次RESOURCE_LOAD console errors、2次auxiliary proxy failures，沒有當成全UI/hydration PASS。handler/seed無Production或正式外部副作用。

慢查詢、lock/pool/resource耗盡、public lifetime quota/永久loss與鎖競爭MAJOR仍開啟；typed persistence error fallback不能解除整個availability問題。舊page helper間歇null、SSI7/13/HTTP失敗根因未解。完整入口/RSC/query/alias、minimum runtime role、source epoch、typed positive visits/viewing與非零五項M1/M2仍待完成。

## Ownership、回滾與後續

root唯一writer，external readonly sequential，depth1/parallel1/automatic_spawn=false。全部變更在獨立worktree C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal，base efb8b7e9。原dirty工作樹未操作，沒有commit/push/deploy，無Production/.env*/Secret Store/正式資料或raw logs輸出。CI已存在push/PR lint及tests，本輪未改CI也未執行遠端CI。

回滾只針對本輪helper/callers接線，先停用owned非正式collection並停gateway/app，保留source/frame/gap/seal與migrations/125 gate；不要逆向migration、刪資料或復活舊cache。臨時fault物件已移除、mutation已rollback、容器/鏡像已清理。

下一步仍是來源入口閉合與minimum role、真正source epoch/typed positive producers，再驗收40%、60%、66.67%、83.33秒、50%。7天只用於完看後訂單資格。完成WP仍01/05/06/07/08/10/11/15，D2～D6依賴項WAITING_AUTHORIZATION並跳過。

Evidence：docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/optional-metric-page-{route,validation,db,harness-lint,react-review,*review*,checkpoint,changed-files}.json；before-signal收據保留為歷史snapshot。
