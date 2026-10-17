# WP-20 可信 coverage producer 實作契約

狀態：registration 與 orders 私有 producer 已實作，並有空來源、對帳、來源競態、proof 寫入與報表失效的本機實測；完整 WP-20 尚未驗收。visits/viewing producer 與 report scheduler 的部署整合尚未完成；私有queue producer/tick已完成分項本機驗證。orders 的 window fence、付款隔離/死鎖與升級保護已有分項證據，原同步 20 筆 Serializable gate 仍為 7/20 FAIL。獨立審查的剩餘 findings 與未部署事項以最新 handoff 為準。

## 現況與不能使用的捷徑

- `reconcileMetricRegistrations` 只掃 `LiveMetricRegistrationCapture`，不是所有 `FormSubmission`。初始 capture 失敗可被 savepoint 吞回且保留商業報名，因此 pass_complete 不能證明分母完整。
- `collectMetricVisit` 明確不保證 collection coverage；收到事件與沒有 VisitLoss 都不能證明遺漏事件不存在。
- registration 正向證據由私有 publishRegistrationCoverage 內部執行雙向對帳，綁定來源與版本 revision、count、digest；reader 拒絕缺少 provenance 的舊正向紀錄。其他 kind 不能由排程任意產生 covered。
- FormSubmission 與 LiveMetricRegistration 的 INSERT/UPDATE/DELETE 已使用 insert-only LiveMetricRegistrationSource ledger；私有 revision 使用 COUNT，避免 sequence 配發與 commit 順序不一致。報表與 registration coverage 均綁定來源 revision。

## 分類證據與寫回前提

| kind | 必須對帳的權威來源 | 不能認證 complete 的情形 |
| --- | --- | --- |
| registrations | 同租戶/場次/版本的原始已驗證 FormSubmission，逐筆比對 immutable capture 與 materialized registration | 缺 capture、版本不能確定、身份/時間不符、補登未完成 |
| viewing | 全部應收 session 的發行紀錄、每個 session 的 contiguous sequence、正式 close/final sequence 與loss | 有未結束/遺失session、區間缺洞、無法證明session全集 |
| visits | 收集開始邊界、應收事件的持久 intake/outbox 與ack/loss對帳 | 只有成功事件、瀏覽器未回報且無持久來源、歷史無收集契約 |
| orders | 同租戶、已結束時間範圍的權威訂單全集，含未歸屬來源；匹配與明確排除分類，並核對同快照 window/registration revisions | attribution缺失/錯誤、來源revision變動、期間尚未成熟；不得以INNER JOIN回傳筆數替代全集 |

未知與缺漏應回傳 unknown/gap；不能因其他kind完整而替它認證。已知空集合必須來自權威來源枚舉完成，不是缺資料的預設值。

## 實作順序與 ownership

1. 先實作 registration 的原始來源對帳 reader：同一 read-only RepeatableRead snapshot，具 scope/window/來源revision、page/row/time上限；回傳缺漏分類與 digest，不回傳客戶資料。producer不輸出email/name/phone。
2. 補來源插入/變更的revision binding，讓對帳完成後新增的verified source也會令證據失效；用兩連線驗證，禁止只比對 row count。
3. 私有 audit writer 在 ReadCommitted 重新核對上述來源revision、版本/範圍與proof；不接受HTTP送入covered或digest作為證明。原子寫入audit與持久proof。
4. 分別完成 visits/viewing/orders 的來源閉合對帳；不能把registration證據複用給其他kind。無法證明的歷史保留unknown，不回填假complete。
5. 接 report scheduler：已授權scope → 對帳 → coverage → claim → snapshot → worker → publish → reload → finish；有未知項目仍輸出明確unavailable。排程不得依賴瀏覽器觸發或改寫報表輸入。

## 驗收情境

- 原始verified submission存在但capture不存在：不認證complete，不能被pass_complete掩蓋。
- capture存在但registration缺失/身份不同：不認證；正常補登後才重新對帳。
- 對帳與寫回之間新增或修改verified來源：舊證據被拒絕，舊ready報表失效。
- 空來源、全匹配來源、跨租戶/版本、未知歷史、timeout/分頁中斷及重試：各自驗證，失敗不留下正向audit。
- 真實disposable DB與非Production deployed job端到端；Migration/Permission獨立深度審查；同snapshot acceptance。

## 回滾與限制

先停新增producer/scheduler，既有讀取回到unknown；只移除本scope派生proof/audit，不刪原始報名、觀看或訂單。不得正式環境部署。現有completion負載通過不代表此producer已完成；原contention gate仍FAIL。

## 新增驗證證據

registration-proof-race-db.json：107 migrations、空來源、全匹配、撤銷失效與對帳後來源變動 PASS。後續 registration-bidirectional-50k-db.json 已驗證 50k來源+50k投影在4993ms完成；registration-proof-insert-race-db.json 已驗證revision讀取後、INSERT前的commit交錯。更大負載、完整report lifecycle交錯、獨立review與部署後排程仍未驗收。原 Serializable gate 仍 FAIL。完整 evidence 位於 docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/。

- 投影生命週期證據：registration-projection-lifecycle-db.json，刪除與重建投影都不能復活舊proof；只有重新對帳產生新proof後恢復complete。
- 商家cascade證據：registration-vendor-cascade-db.json，合成Vendor連同來源、capture、projection、ledger與report刪除後無孤立資料。這不等於授權正式商家刪除。

## Orders producer 入口核對

現有 `readMetricOrderPage` 透過 CommerceOrder → primary PaymentTransaction → LiveMetricRegistration → verified FormSubmission 的 INNER JOIN 取得可歸屬資料。這是報表事實讀取，不是完整性認證：缺primary payment、metadata歸屬缺失、缺registration projection的來源會被JOIN排除。目前orders audit從權威訂單與server-owned attribution枚舉候選、明確分類排除原因，並核對同一RR快照的order與registration revision；不得改用報表reader的回傳筆數宣稱complete。以上全集與分類要求已由私有 `auditMetricOrderSources`／`publishOrderCoverage` 實作，完整 WP-20 驗收仍未完成。


## 最新 orders 分項狀態與下一個功能範圍

- 私有 producer 由內部完整 audit 產生 proof；新格式 orderProofVersion=2、scope/window綁定的proof ID與postwrite核對，舊正向資料不能冒充新證明。
- window ledger 與 report/coverage consumer 已切換，單筆期間外訂單不使既有已結束期間報表失效；持續流量驗收仍待。
- 付款/link的18 isolation schedules、非等待snapshot與9 deadlock schedules已有本機證據；真實signed callback在ORDER_TRANSITION遇deadlock後第二attempt成功，已測affiliatepath一次帳務與duplicate counts不變。這些不替代原同步20 gate。
- 117升級保護使用linked payment的MVCC write，舊snapshot拒絕；100k synthetic literal SQL touch為5674ms、WAL89350336bytes、競爭writer163ms收到55P03。付款欄位與來源事件不變。trigger queue peak memory未量測，正式規模未讀取；最新獨立review無本機BLOCKER/MAJOR，仍有容量/部署路徑/證據完整性的MINOR/NIT；不作release認證。
- 下一個尚未完成的功能範圍是visits/viewing來源閉合與report scheduler/deployed integration；不能一直把來源安全分項PASS當五項統計功能完成。尚未授權的D-2～D-6依原Goal Plan跳過。

上述分項收據見 `docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/`，所有狀態以 `product-audit-20261012-handoff.md` 最新段落為準。


## Viewing 來源品質稽核（尚非 producer）

新增 `auditMetricViewingSources`，在同一read-only RepeatableRead中以session/interval keyset逐頁枚舉所有overlap sessions，保留open/incomplete、身分失效與outside-cohort分類。每個session與interval都計入共享row budget；session跨page時沿用sequence/progress狀態，digest不依pageSize改變。讀取不含姓名/email/電話。

30 unit、lint/typecheck及disposable DB已通過：closed empty與有interval session、open session、budget discard、foreign scope、關閉session的兩連線snapshot及驗證撤銷。delivery closed/contiguous不等於看完影片；enumeration結果一律coverage unknown，不寫covered proof、不變更UI或HTTP。

下一步仍需持久session發行/來源閉合契約、viewing revision/proof binding、producer與scheduler。session table當下無資料不能證明歷史無遺漏，不能直接用此稽核回傳列數認證complete。獨立審查由 Claude CLI observed claude-opus-5-5 完成，0 BLOCKER／0 MAJOR／3 MINOR／1 NIT。已修正測試與時間預算問題，補上 validated/nondeferrable composite FK 實測；修正後30測試、型別與DB通過，修正版尚未獨立複審，不能以舊收據宣稱READY。整體WP仍未完成。


## 私有背景報表 tick（本機已驗證，尚未部署排程）

新增 `runMetricReportSchedulerTick`，只從已授權 vendor/live/version 的既有 queue 選取已結束時間窗；預設每次1筆、最多4筆，依 DB clock 排除有效租約與過期報表。選取只提示候選，既有原子 claim 才決定 ownership；每個 attempt 使用新的 server-owned worker ID，序列執行既有 snapshot／隔離worker／projection publish／reload／finish。沒有 enqueue、全域掃描、來源啟用或新的 HTTP 端點。admission budget 只阻止啟動下一筆，不中斷已執行的 bounded job。

16 unit、lint、typecheck及117 migrations的disposable DB通過。真實隔離worker、分批清queue、有效租約與foreign version/tenant排除、兩個tick同時搶件只一次計算與一次attempt、重複tick不重算均PASS。缺coverage的五項統計仍為unavailable/missing_data。`recorded`只表示aggregate已儲存，不表示來源完整。首輪fixture因重複active window違反23505已修為不同合成時間窗，未改產品約束。首輪review的佇列阻塞假設已用原claim與實測反證：達五次cap的head標failed，下一tick處理後續；同時補barrier搶件、過期租約恢復/舊owner finish拒絕、真實第二租戶、過期報表/版本、future-window create guard與unexpected rejection清理。修正版follow-up已回覆並撤回先前MAJOR，剩3 MINOR/3 NIT；AGY回傳observed model/effort unknown，不能推定指定slug已實際執行，未標READY。最新typecheck PASS；完整收據與未驗證項見review-disposition。

host authentication、允許scope清單、cadence、worker artifact供應、queue產生與非Production部署整合仍未完成；私有tick不代表排程已在Preview/staging啟用。Evidence：`coverage/report-scheduler-{route,unit,lint,typecheck,db,review*}.json`。

## Viewing 緩衝區已知遺失保護

`createMetricDelivery` 原先在capacity溢位後送出已保留prefix的final close，會讓server顯示contiguous closed但漏掉後續播放。現在仍依原sequence重送/排空已保留資料，capacityReached後永不送final close；保留server open/incomplete訊號。剛好滿但未遺失任何segment仍可正常close。此修正沒有推測遺失區間，也沒有把delivery closure改成觀看完成；session發行前失敗與完整intake/outbox仍未解決。

後續producer必須將持久預期收集來源、session發行全集、close/loss及來源revision綁在同一契約；不能只對現存closed sessions數量認證complete。歷史沒有該契約的期間繼續unknown。

觀看delivery的獨立review在原受審來源無BLOCKER/MAJOR、1 MINOR：finish與pending清理的microtask競態。已先重現close呼叫0次，再修正為等待active pass後補一次flush；53項相關測試與87項播放器/transport/release回歸PASS，修正後尚未獨立複審。未重新宣稱完整來源或WP READY。


## Viewing 持久發行／來源紀錄（118，本機驗證）

新增LiveMetricViewingEpoch與LiveMetricViewingSource。新版本INSERT才以DB clock建立epoch；既有版本不回填。Session issued/state/removed與interval INSERT均由source trigger原子記錄，只跳過whole-row完全相同的no-op UPDATE，progress與未來新增欄位的變更均留state紀錄；issued唯一鍵禁止已刪session ID重用。Source無session/registration FK，保留刪除tombstone；只有整個version刪除才能cascade清理。PUBLIC/常見API角色無表/序列/函式權限，RLS開啟；直接偽造INSERT、UPDATE/DELETE/TRUNCATE被拒絕。

私有audit同一primary RR快照透過SECURITY DEFINER/STABLE provenance函式讀取viewingRevision、epoch及以每個session任一歷史事件overlap計算的issued/removed counts；輸出明確標recorded_only，避免RLS靜默過濾成零，digest升為inspection-v2並綁定這些來源。COUNT是可見event的revision，不能拿BIGSERIAL最大值當commit watermark。刪除前後即使current sessions變少，issued/tombstone與digest仍反映變化。epoch晚於window或不存在時history unknown；ledger_enabled也只表示開始記錄，coverage仍unknown。

72項source/version/session相關unit、lint、typecheck及118 migrations disposable DB通過；實測發行/interval/state counts、no-op不加event、刪除tombstone、禁止竄改與偽造、ID重用拒絕、rollback、兩交易反序commit採COUNT、無權role拒絕與version cascade無孤立資料。首輪清理probe使用未生成的Prisma model失敗，改為相同DB SQL DELETE後通過，未改產品約束。已有資料的117→118升級、來源完整性writer/consumer綁定、發布播放前的持久intake、完整producer仍未驗證/未完成。首輪qualified Opus deep review提出6 MAJOR/7 MINOR/4 NIT；已修whole-row/progress漏記、期間計數、RLS讀取邊界與source truncate，保留整包與owner-role部署限制，修正版qualified Opus follow-up已回覆，保留2 BLOCKER/2 MAJOR/3 MINOR/4 NIT；其中既有全WP/角色部署阻擋未解除，負載MAJOR仍未量測。後續補session grouping index、無效window拒絕、duration digest、atomic/bounded DDL與unexpected ACL guard，尚未獨立複審，未標READY。

Evidence：coverage/viewing-ledger-{route,snapshot,unit,lint,typecheck,db,review*}.json；scripts/wp20-viewing-source-ledger-disposable.mjs。


### 下一段端到端 intake scope

發行ledger不能替代播放前intake。現況是playback-source先回傳URL，collector之後才以browser UUID呼叫sessions，中間斷線無持久期待來源；因此118不發布covered。後續在成功播放來源回應之前持久建立server-owned request UUID，綁定同vendor/live/version與已授權admission，前端collector沿用此UUID，session發行核對並一對一關聯。未收到來源回應、未發出session或未關閉都保留可對帳的pending/gap；不得把未追蹤的舊client/session當作已知零。

需沿用現有版本fingerprint/runtime選擇、資格與moderation revalidate、server clock/期限/資源上限；未配置收集的場次仍保留原播放行為與unknown統計，不自動建立/啟用版本。不讀cookies內容做診斷、不傳播credential，產品code只用既有server authorizer。精確下一scope候選為live-metric-version.ts、private intake service及DB119、live-playback-source route、session issuance service/route、HTTP source parser/collector wiring與相應unit/DB/browser tests；開始前重新route，Migration/Permission獨立深度審查，root單一writer。

驗收要包含：URL回傳前commit、遺失response留intake、session retry同UUID不重複、跨tenant/version/admission與重用拒絕、context變更fail closed、collector卸載/response delay、無追蹤版本不偽造intake/covered。後續viewing producer仍須把intake全集、ledger、cohort、loss與writer fence同snapshot對帳，不能直接以一個成功session認證整個window。此段尚未實作，不是完成證據。

Trusted boundary：DB migration/function/table owner必須受信任，本功能不宣稱抵抗superuser或owner改DDL。正式部署須使用分離的non-owner runtime並驗證精確grants/retention權限；本輪只在disposable DB驗證合成non-owner角色，不代表已配置正式環境。

最新補強：118以BEGIN/COMMIT與5s lock_timeout/30s statement_timeout原子執行；所有新物件ACL若含未知non-owner grant，migration fail closed。實際注入額外SELECT grant觸發23514並rollback，沒有移除產品guard。完整audit以受限non-owner effective role執行與owner結果相同，該role無superuser/BYPASSRLS/INHERIT，也無法讀ledger或ALTER/TRUNCATE/刪version；這是disposable SET ROLE證據，仍不是實際Preview/staging login/deployment驗證。Nested non-owner trigger偽造也被拒絕。

無效window直接private function呼叫會23514；revision/provenance兩定義實測一致；duration納入digest，Interval sequence/media欄位catalog確認INTEGER。Partial issued唯一索引與scope/session索引存在；列出的trigger名稱與啟用狀態已查核，完整relation/function binding與Prisma drift仍未全面驗證。所有新增role/policy/grants/temporary probes均已清理，container/temp cleanup PASS。

播放前intake的下一段已先抽出resolveMetricPlaybackContext，讓同一server runtime/fingerprint/version/expiry選擇可供session與intake使用；沒有收集版本回傳null，但既有session入口仍拋not_authorized。新helper與session相關38 tests包含在本輪72項中，尚未獨立review；沒有新HTTP或intake表接線。另需browser驗證：collector收到403而disabled後，後續完成身分驗證是否會重新建立collector，不能假設cookie更新就能恢復採樣。


## Playback-before-response intake（119，尚無正向producer）

LiveMetricPlaybackIntake在播放網址離開server前commit，綁server UUID/vendor/live/version/admission與DB時間；session HTTP發行強制綁定且one-to-one。UUID只由server發行，client/factory使用該UUID，未取得或格式錯誤不能自造。遺失response仍留下unmatched intake；legacy internal NULL intake不能當完整來源。每admission/version最多64筆，超出則保存一次永久lossAt後保留播放。loss涵蓋此後未知未追蹤播放，不能以原intake expiresAt截短，也不能因舊UUID後續成功發行就消除。

新version才有playbackIntakeStartedAt，無backfill。NULL epoch、epoch前已開始的播放、collection未啟用期間取得但持續播放的網址均無法證明完整；producer必須保留unknown，不能拿成功session或空表認證全集。只發行intake不等於確認cohort身分；匿名、未驗證、身份變更與未回覆session須明確對帳，不能默認排除。每筆expiry限制於當下admission/runtime/version；session UPDATE不能改anchor/admission或超出intake，尚無安全續期，不得假稱長影片完整。下一段續期需舊lease到期前、同身份、DB-clock原子檢查與持久revision，逾期一律保留空窗。

119 migrations、實際DB guard與column ACL probe、174 unit/lint/typecheck、合成錄製VOD browser實際9段interval/close PASS。此browser使用fixture authorizer，signed Next HTTP、live/WHEP、長時間續期、負載/升級與實際deployed role仍NOT_VERIFIED。Trusted DB owner可更動DDL，不宣稱抵抗owner/superuser。尚無intake→viewing coverage writer/reader fencing與排程部署；full WP NOT_READY。


## Playback lease renewal（120）

只在舊intake/session未過期時續期，同identity/anchor/sequence保持不變；DB clock在鎖等待後重驗，expiry不超current admission/version/runtime。每次有效extension由DB加renewalCount，intake revision包含sum(counter)，loss永久保留。Server兩筆更新同交易；client同UUID續期並只延長clock期限，過期/授權中斷不能復活或close為完整。這補上持續lease，不構成來源全集或positive coverage；producer仍須拒絕NULL/epoch前/collection啟用前持續播放、unknown identity與未對帳intake。當前246 unit/lint/typecheck、120 migration與同session browser7段、過期拒絕及跨鎖等待expiry rollback PASS；長時間soak、signed HTTP/live/WHEP、populated upgrade/load與部署整合未驗證。


## 同快照 intake 對帳（recorded-only）

viewing audit v4由121 private SECURITY DEFINER/STABLE page函式枚舉intake與session/interval/current identity，所有public表引用明示schema，row_security off、limit501、參數與ACL guard，PUBLIC/API預設無EXEC。可見intake但不可見session、或可見session但不可見FormSubmission的NOLOGIN稽核角色，經明確EXEC grant後仍得到與owner相同來源；未授權EXEC則42501。探測grants/policies/原RLS狀態與role皆清理，實際部署角色仍未驗證。

source digest只綁定資料與revision，classification digest另綁asOf和分類；pending到期不偽裝來源列改變。outcomes明示whole_version且區分pre_window_expired；quota loss獨立保留，不撤銷原nonce或被原expiry截短。摘要只涵蓋已記錄來源，仍recorded_only/coverage unknown，不證明所有URL/身分皆已instrument。建立正向writer前必須明定報表觀看期間，以及完看後7天內下單的資格與暫定轉換標記、pre-epoch URLs、replay/verification恢復與source fences，並將intake/viewing/registration revisions綁定writer/reader。298 tests與121 migrations/真實DB/RLS/跨連線PASS，不等於上述writer/生命週期已完成。


## 原頁驗證恢復與重播來源

controller只在readiness hint允許後重新取得server-owned intake，再由POST獨立授權建立新session/anchor。前一個unmatched/lost intake不刪除、不轉成零、不從舊anchor補造samples。hint不檢查舊intake，因為目的正是取得新的來源；它不構成任何positive coverage。正常新session允許立即下一次重播；denied/failed backoff跨ended/playing保留30秒。離頁取消GET，但server已提交的intake即使client未收到仍保留待對帳缺漏。326 tests與owned121 DB/真實VOD原頁恢復/重播PASS，只涵蓋fixture identity；完整簽章HTTP、live/WHEP、長時間實播與完整URL/cohort閉合仍未驗證。


## 固定期間報表排隊入口（122，本機驗證）

enqueueMetricReport由host提供已授權scope與已結束window，在version-first鎖下核對DB clock/版本/revisions並去重，不掃全域、不啟用收集或認證coverage。failed當前generation不重設五次attempt cap，來源變更後才建立新generation。122 create只替換相同window的過期/過時前代，不拿B期間revision使A失效；其他window由原consumer重新核對各自來源。87 unit、lint/typecheck與122 disposable DB/真實worker通過；host認證、allowlist、cadence與實際非Production部署尚未完成。完整來源未證明時報表仍unavailable。

規則更正：7天是完看後下單資格，觀看依選定報表期間；完看後尚未觀察滿7天的轉換依既有provisionalConversions標記。先前文字稱7天觀看觀察窗不成立，沒有據此修改業務規則。


## 私有本機程序host（無schema變更）

createMetricReportHost以固定scope/window設定執行queue→tick→worker，每輪global attempts上限4，序列執行與完整cadence、scope輪替、入場預算及graceful stop。設定scope授權包含該版本既有佇列；固定window僅限制新增。Launcher只有owned loopback disposable PostgreSQL binding與OS程序身分，沒有HTTP listener，不等於Preview/staging持續部署。固定TypeScript builder與最小注入環境；106 tests與獨立child/真實1秒cadence/row-lock等待中的停止/122 DB PASS。完整來源未知時仍missing_data；正向producer、實際部署身分/grants與整合仍須完成。操作文件見wp20-metric-report-host.md。


## Browser-started造訪期待來源（123，非正向coverage）

prepareTrackedMetricVisit在回應前持久提交未計數的visitor/event intent；公開collect必須同scope/visitor/event核對後才能同交易寫入。回應遺失留unmatched，不換身份接管；事件大小寫/重送不重複計數。immutable/server-time/RLS/owner ACL與version cascade由123 migration保護。81 unit、lint/typecheck、123 disposable DB及實際public context/proof/composition PASS。這只涵蓋browser-started prepare已抵達的來源，不證明所有頁面/no-JS/初次請求的全集；不得以沒有unmatched推論complete。仍需可見性/provenance/revision/proof/fence/reader與部署綁定；完整收據、失敗fixture與review限制見最新handoff及wp20-visit-intent.md。


## 公開頁期待來源（124，非正向coverage）

/live/[slug]使用request-time未計數page expectation，commit後交server UUID給client；public prepare在visitor前核對同scope/version/page/expiry。noJS/lost/prefetched render留unmatched，不算visit。每version10000上限與advisory admission/trigger，滿額先永久記lossAt再普通頁無collector；不刪未知來源。115 unit/lint/typecheck與124 disposable DB、8並發最後名額、真實2秒expiry race通過；Next HTTP/CDN/cache/負載/upgrade/deployed roles未驗證。尚無source complete epoch，需page→intent→fact/loss、revision/proof/fence/readers；不能以有page或無unmatched認證complete。見wp20-visit-page.md與最新handoff。


## 暫時排除未證明正向旗標（125）

已在canonical124實際重現無來源visits/viewing covered被讀成complete。125拒絕新增，對current不可信旗標的version推進revision清除舊cache/lease，原audit保留；reader SQL/TS都排除這些positive，gap保留。59 tests/lint/typecheck、125全新DB及schema-equivalent populated compatibility replay PASS，獨立followup0 findings；非populated CLI升級/完整producer驗收。暫時gate必須與可信proof/fence/reader一起被替換。下一個來源缺口是/form與funnel的server-bound報名入口，不能只追蹤/live或admitted page_view就稱報名頁分母完整。見wp20-unproven-coverage.md與最新handoff。


## 報名頁來源接線 checkpoint

/form與funnel唯一可確定場次的報名surface已接上server expectation，同交易重查form/live/vendor；185 tests/lint/typecheck、125 disposable17 checks PASS。仍未持久區分報名與viewer來源，後續分母必須只使用可信報名source，舊資料不回填。公開SSR耗盡10000/version與鎖競爭MAJOR仍OPEN，不能吞錯或刪unmatched掩蓋缺漏；125 gate保留直到對帳/proof/fence完成。審查範圍/省略CSRF行/未驗證項見wp20-registration-surfaces.md與registration-surface-checkpoint.json。


## 126：報名來源分類與分母隔離

sourceKind/sourceFormId保留server發行時來源，舊資料/缺參數unknown；viewer明示viewer。報名reader要求registration page與同event/visitor intent，不依當前form重標歷史。224 tests/lint/typecheck、126 disposable20 checks PASS，scope深度複審無BLOCKER/MAJOR。ALL-source version loss必須獨立消費，不能將報名source filter用於loss；quota永久loss MAJOR、歷史form scope、完整對帳/proof/fence仍待。125 gate維持啟用，詳見wp20-registration-source-classification.md。


## 全來源 loss／訪客 reconciliation 已接入 reader

同版本所有sourceKind的永久loss、page/intent/fact來源對帳，現在由報表同primary RR讀取；已知audit gap優先，來源明示not_read。transaction_timestamp保守下界關閉window，wall clock只供合理性檢查；仍非in-flight writer fence。253 tests/lint/typecheck、126 disposable29 checks PASS，final兩source review無BLOCKER/MAJOR。audit RLS role提案、cap/鎖MAJOR、來源epoch/URL全集/歷史form與typed positive proof仍待；baseline一次Error未確認根因，不宣稱修復。詳見wp20-visit-reconciliation.md，125 gate保持。


## Audit可見性守門

已以真實registration/order producer及RLS隱藏gap重現舊reader假complete。新共用guard涵蓋audit/source read，驗證primary/RR/explicit tx、同步與alias/跨bundle/延後metadata、較嚴timeout/還原；無部署grant或schema變更。268 tests/lint/typecheck、126 disposable39 PASS+1 REPRODUCED，Critical最新scope review無BLOCKER/MAJOR/MINOR。任意未受guard管理的同tx SQL仍在caller contract外；actual loader sequential。正向producer/fence/配額與完整M1M2仍待，125 gate維持，舊偶發FAIL未確認根因。詳見wp20-audit-visibility.md。
