# CelebrateDeal 產品路線圖與優先順序報告

> 評估基準日：2026-09-03（Asia/Taipei）
> 文件性質：產品／規劃參考文件，不取代 current readiness truth、release gate 或 owner decision。
> 主要輸入：Perplexity 專案分析、目前 repository、canonical readiness／requirements／decision 文件。

## 一、先說結論

Perplexity 的建議方向大致正確，尤其是「先完成金流與結算閉環，再強化商家與推廣者工作台，最後擴展差異化能力」這條主線。不過，其中有幾項把 CelebrateDeal 已存在的 MVP 骨架，描述成尚未實作；也把「本機已驗證」與「正式環境已通過」混在一起。

依目前專案內的 canonical evidence，較準確的結論是：

- CelebrateDeal 的工程基礎與核心領域模型已相當完整，`canonical total=75.5/100`。
- `ENGINEERING_READY=true`，但 `PAYMENT_RECONCILIATION_READY=false`、`SANDBOX_READY=false`、`PRODUCTION_READY=false`。
- 目前 release decision 仍是 `NO_GO`；這不是功能不存在，而是正式付款、外部服務、staging／recovery 與人工責任證據尚未全部閉環。
- 下一階段的核心不是「再做更多頁面」，而是把已存在的直播、內容、團隊歸因、訂單、退款、佣金、結算與交付能力，收斂成一條可安全驗證、可由第一批商家完成的成交流程。

因此，本報告採用以下產品主軸：

> **先完成安全可驗證的第一個商家成交流程，再把「組織型銷售＋可信分潤」做成 CelebrateDeal 的辨識度，最後才投入平台級擴張。**

## 二、對外部分析的校正

| Perplexity 的判斷 | 目前專案證據 | 本報告的處理方式 |
|---|---|---|
| 技術成熟度約 75–80%，接近 production-ready | 工程證據確實強，但 readiness snapshot 明確維持 `PRODUCTION_READY=false`、`NO_GO` | 保留「工程成熟度高」；不使用「可正式上線」或「production-ready」描述 |
| 商家後台仍需建立 MVP | 已有 dashboard、商品、訂單、直播、表單、Email、affiliate、billing／admin routes 與元件 | 改列為「商家工作流與真實使用驗收尚需收斂」 |
| 結算、出款與分潤爭議尚未實作 | 已有 settlement、payout batch、payment account、invoice、commission ledger、reversal／dispute 狀態與相關 actions／頁面 | 改列為「操作政策、外部出款、批次排程與 owner evidence 尚未完全閉環」 |
| 尚未有發票與帳單 | `Invoice` 模型與 billing invoice 頁面已存在 | 電子發票、台灣稅務規則與正式帳單流程另列待決策／整合工作 |
| 似乎只有 PayUni | 已有 provider adapter 邊界，且有 PayUni 與測試／示範 provider 路徑；但正式 provider evidence 尚未完成 | 多金流仍列中長期，不把 adapter 或 demo provider 宣稱成正式多金流支援 |
| 分潤規則仍是硬編碼 | 佣金、課程分潤、平台推薦與 append-only ledger 已有實作；多數 financial integrity 已有測試 | 中期做「版本化、可預覽的規則設定」，不直接做過度通用的規則引擎 |
| 缺少 LINE、工作流與進階互動 | 本輪檢視未見 LINE Official Account 或通用 workflow engine；抽獎／投票／紅包也未列為現行核心範圍 | LINE 列中期驗證；workflow 與進階互動列長期，並附合規與反濫用前置條件 |
| 回放歸因與佣金可直接加入 | 現有 replay、playback usage、team conversion attribution 與付款歸因已存在，但「回放是否產生佣金」仍是產品政策 | 先定義 attribution／commission policy，再實作回放分潤 |

外部分析因此適合作為「候選 backlog 與方向提醒」，不應直接當成目前缺陷清單或核准 roadmap。

## 三、優先順序與時間尺度

時間尺度是相對優先順序，不是對外承諾的日曆期限；每一項以驗收條件完成為準。

| 層級 | 時間 | 主要目的 | 決策原則 |
|---|---|---|---|
| 短期 | 0–4 週 | 關閉 release-critical 證據，讓第一批商家可以完成一條可信流程 | 先補閉環與證據，不擴張產品面積 |
| 中期 | 1–3 個月 | 把組織型銷售、推廣者工作台、分潤可信度與通知能力產品化 | 只做能提升啟用、留存、對帳信任的功能 |
| 長期 | 3–6 個月 | 依實際需求擴展多金流、自動化、進階直播互動與組織商業模式 | 先有客戶需求、政策與容量證據，再投資平台級能力 |

## 四、短期目標：0–4 週

### S1．完成 non-Production release evidence 與付款驗證閉環（P0）

這是正式商業化前的首要工作。範圍限 staging／sandbox／受控外部 provider，不包含 Production deployment、正式付款、正式退款或正式寄信。

工作內容：

- 依 `current-release-owner-action-packet` 補齊 current source lineage、owner authorization、non-Production scope 與 callback host reference。
- 以同一 source lineage 驗證 staging migration、backup／restore、rollback／forward identity 與 release bundle。
- 完成 Cloudflare Stream、Resend、Sentry、PostHog、durable rate limit 的最小 provider smoke evidence。
- 依 CAT04 規則完成 PayUni Sandbox 的 order、provider reference、amount、payment status、refund、callback、duplicate webhook 與安全邊界 reconciliation。
- 保持 `MISMATCH`、`UNKNOWN`、`UNVERIFIABLE` fail closed，不以 local／synthetic receipt 代替外部證據。

完成定義：

- 所有執行都有 sanitized receipt、環境識別、source lineage、owner reference 與可追溯結果。
- `PAYMENT_RECONCILIATION_READY` 只有在實際 outcome 可驗證時才可改為 `true`。
- 不因本機測試或 provider adapter 存在，就提前宣稱可正式收款。

### S2．收斂商家 onboarding 與 first-live／first-sale 流程（P0）

商家後台不是從零開始，真正缺口是首次使用是否能順利完成。短期應把現有 dashboard checklist、8-step live flow、預覽、表單、商品、通知與 CTA 串成一條可觀察的任務路徑。

工作內容：

- 由產品 owner 決定 onboarding 是否需要 template/import、跨步常駐 preview，以及直播模板／場控時間軸。
- 保留草稿、自動保存、pending／error／retry、公開狀態與付款狀態的真實提示。
- 以 3 組設計合作夥伴先驗證；90 天行銷目標仍可維持 5 組合作夥伴。
- 量測從建立內容到可預覽直播的設定時間、卡點、完成率與第二條流程建立率。

建議驗收指標：

- 至少 3 組設計夥伴各自完成一條可預覽的直播／錄播銷講流程。
- 7 天內完成既定啟用條件的比例至少 60%。
- 首次從建立內容到夥伴取得推廣頁的中位時間以 90 分鐘為初始目標。
- 沒有正式成交證據時，只報告完成率、點擊、報名與可驗證狀態，不宣稱營收或轉換提升。

### S3．把結算、出款、退款與爭議變成可執行的營運閉環（P0）

這一項不是重做資料庫。現有 settlement、payout、invoice、commission ledger、refund adjustment、audit 與 CSV 能力應先被整理成一套商家／財務／客服都看得懂的操作政策。

工作內容：

- 定義月結週期、可結算條件、退款後扣回、佣金 reversal、payout batch、failed／retrying／paid 狀態與人工介入點。
- 明確區分「平台已產生可稽核的出款資料」與「銀行／外部 provider 已完成實際匯款」。
- 確認 payment account 的驗證、rotation、停用與 recovery 邊界；不在沒有授權時操作真實銀行或正式付款。
- 建立佣金爭議申訴、案件編號、證據保存、處理期限與結果通知流程。
- 以現有 append-only ledger 保存 opening snapshot、accrual、refund、reversal 與 dispute entry，不用覆寫歷史金額掩蓋差異。

完成定義：

- 商家、財務與客服能依 SOP 判斷每筆 settlement／payout／commission 的狀態與下一步。
- duplicate、refund、ambiguous provider outcome 與跨 tenant binding 都維持 fail-closed。
- 外部匯款與稅務／電子發票責任尚未完成前，公開文案不得說「自動匯款」或「完整報稅」。

### S4．補齊最小可用的監控、客服與政策責任（P0）

目前程式已具備安全 monitoring wrapper、Sentry／Email／PostHog 接線與多份 runbook；短期要補的是實際 owner 能不能在錯誤發生時收到訊號並完成處理。

工作內容：

- 完成最低 production error observability、alert routing 與 support escalation path 的 owner review。
- 核對 Terms、Privacy、Refund、Retention、data request、客服 SLA 與付款異常處理是否彼此一致。
- 以不含 Secret、raw provider payload、正式客戶資料的方式保存責任與結果 receipt。
- 人工 screen-reader journey 可作為 accessibility follow-up，但基本 keyboard、focus、semantic、touch 與 error state 仍維持工程要求。

### S5．先完成必要產品決策，防止工程範圍漂移（P0／Decision）

短期應先處理 `docs/codex-goal/DECISIONS_NEEDED.md` 的決策，不要在需求未定義時直接加入 schema 或大型抽象層。至少包括：

- D-001：匿名 analytics 的可信度模型。
- D-002：公開 referral click 的證明強度。
- D-003：公開夥伴聯絡 Email 與 opt-in。
- D-004：商家 owner／finance role 的 MFA 時程。
- D-005：payment order number 的唯一命名空間。
- D-006：refund provider event identity 的欄位拆分與唯一性。
- D-007：商家全站停權模型。
- onboarding template、import、常駐 preview 與回放是否觸發佣金，也應留下產品決策紀錄。

## 五、中期目標：1–3 個月

### M1．完成商家與推廣者工作台的「可用閉環」（P1）

商家後台與 affiliate routes 已有基礎，因此中期重點是角色任務與資料完整性，而不是單純增加頁面。

- 商家：商品、直播、表單、訂單、通知、退款、結算與用量狀態集中呈現。
- 推廣者：自己的推廣連結、瀏覽／點擊／報名／成交／退款、佣金狀態與提領申請入口。
- 財務／客服：訂單、付款、退款、佣金 reversal、settlement 與 support case 可由同一條 audit lineage 追查。
- 行動版：完成最常用的建立、預覽、發布、查看成效、申請支援任務；補上人工 screen-reader 與複雜 loading／error state 驗收。

完成定義應以任務成功率、錯誤復原率與資料可追溯性為主，不以「頁面數量」作為完成度。

### M2．將分潤規則升級成版本化、可預覽的規則設定（P1）

外部建議的方向值得採納，但不建議一開始就做任意 JSON 規則引擎。第一版應保留可理解、可稽核的限制型規則：

- 規則具有版本、有效時間、適用商品／方案／團隊與明確優先序。
- 商家能在發布前預覽試算結果，並看到 gross、net、refund、fee 與 commission 的差異。
- 付款事件保存當時的 rule snapshot；後續改規則不回寫歷史佣金。
- 保留 append-only ledger、reversal、dispute 與 audit log。
- 先支援最常見的固定比例、固定金額、階梯式與團隊分配；多層級獎金樹要等法律／商業政策確認。

驗收重點是同一筆訂單在 webhook 重送、退款、部分退款、爭議與規則改版後，仍能得到可解釋且不重複的結果。

### M3．LINE 與通知能力：先做交易／營運通知，不急著做登入（P1）

LINE 對台灣市場有價值，但應以設計合作夥伴的真實需求決定優先序。建議先做：

- 報名成功、直播開播／回放、訂單狀態、退款、佣金／出款狀態通知。
- 明確 opt-in、撤回、template version、delivery status、retry budget 與 audit。
- 先讓 Email／LINE 成為同一個通知事件的 provider adapter，不讓商業狀態依賴單一通道送達。

LINE Login 可列為後續選項；在沒有身份合併、帳號恢復與隱私政策決定前，不把它當成短期必做。

### M4．完成 API 文件與使用者教育（P1）

現有 route contract registry 適合當內部契約，但不等於第三方 API 文件。中期可分兩層：

- 先補商家／推廣者操作手冊、FAQ、短 demo、錯誤處理與結算說明，降低 onboarding 與客服成本。
- 確認有第三方整合需求後，只對穩定、具授權邊界的 route 產生 OpenAPI／SDK 文件；不為尚未定版的 internal action 先做公開 API。

所有教育內容都要保留真實邊界：不把 local evidence 寫成 production、不能以虛構觀看／成交／營收做案例。

### M5．補齊回放歸因與直播成效報表（P1）

這是 CelebrateDeal 與一般直播工具的差異化連接點。建議將成效拆成：觀看、互動、商品點擊、報名、同平台付款、退款與佣金，並清楚標示資料可信度。

- 先完成 replay 的 view／click／lead／order lineage。
- 由產品決策確認 replay purchase 是否產生相同佣金、不同佣金或只做 attribution。
- 報表不能把 best-effort click 或匿名 analytics 當成財務級證據。
- 讓商家看到每場直播與回放對團隊、夥伴、商品及退款的貢獻，但保留 unknown／未回傳狀態。

## 六、長期目標：3–6 個月

### L1．多金流 provider（P2）

只有在設計合作夥伴提出明確需求，或 PayUni 的市場／產品限制已被證明後才投入。實作順序建議：

1. 固定 payment provider contract：checkout、signature、callback、refund、query、idempotency、reconciliation。
2. 每個 provider 各自保存 provider account／environment binding 與非敏感 evidence。
3. 逐一加入綠界、藍新或 Stripe 等實際需要的 provider；不把 `ecpay-like`／demo adapter 當成正式支援。
4. 每個 provider 都要有 duplicate、late callback、partial／ambiguous refund 與 cross-provider order namespace 測試。

### L2．自動化工作流引擎（P2）

例如「訂單金額超過某值就通知 VIP」的想法有價值，但應等事件模型與通知 provider 穩定後再做。最低設計要求：

- event／condition／action 有版本與 tenant scope。
- action 具 idempotency、retry、dead-letter、rate／cost quota 與 audit。
- 提供 dry-run／preview 與停用機制；工作流不能繞過付款、退款、權限或 privacy guard。
- 明確限制外部 side effect，避免重試造成重複寄信、重複退款或重複出款。

### L3．進階直播互動（P2）

建議先從低風險的投票、問答、互動 CTA 開始，再評估抽獎與紅包。抽獎、紅包可能涉及活動、公平性、金流、稅務與反作弊責任，不能只當成 UI 元件。

每一種互動都需要：moderation、rate limit、participant eligibility、audit、結果可驗證性、mobile／accessibility 與中斷復原。

### L4．組織型商業化與模板生態（P2）

這是 CelebrateDeal 最值得長期投資的差異化，但應建立在 M1／M2 的真實使用證據上：

- 團隊模板分享／市場：保留內容 owner、版本、可編輯欄位與授權範圍。
- 組織績效儀表板：顯示團隊、個人、商品、直播、退款與佣金，並清楚區分資料可信度。
- 組織競賽與排行榜：先取得產品與公平性政策，再處理獎勵與反作弊。
- 組織間結算／分帳：等多組織交易量與責任模型明確後，再設計 settlement boundary；不能用現有單一 vendor ledger 直接推演。

### L5．長期品質與營運能力（P2）

- 真實流量下的 field CWV、錯誤率、provider delivery 與告警趨勢。
- visual regression、長時間直播／回放、fault injection、load／deadlock 與恢復演練。
- 在不降低既有 assertion、coverage threshold 或 fail-closed 邊界的前提下，逐步降低大型 root actions 與 UI hot spot 的維護成本。

## 七、差異化主軸：不要只做「更多功能」

CelebrateDeal 對 Bombmy 或一般直播工具的差異，不應靠抽獎、紅包或頁面數量堆疊，而應集中在三個可被驗證的承諾：

### 1．組織型銷售

一位主理人建立受控內容，團隊夥伴取得自己的推廣頁；版本、欄位鎖定、來源與 owner lineage 都能追蹤。

### 2．分潤可信度

從付款、退款、佣金、reversal、dispute 到 payout，保留 append-only ledger 與 audit snapshot。報表寧可顯示「未回傳」或「待對帳」，也不把 click 寫成 conversion。

### 3．直播／回放／售後的同一條閉環

讓內容、報名、商品、訂單、交付、退款、客服與分潤在同一套營運語言中連起來。這會比單一互動特效更能形成長期 switching cost。

## 八、建議的投資閘門

| 類別 | 先做 | 暫緩或先決策 |
|---|---|---|
| 上線 | non-Production provider／PayUni reconciliation、staging recovery、最低 observability、政策與 owner evidence | Production deploy、正式付款／退款、未授權外部操作 |
| 商家價值 | onboarding、first-live、first-sale、商家／推廣者工作台 | 大型通用 page builder、全功能 CRM、POS |
| 財務 | 既有 settlement／payout／ledger 的政策與操作閉環、爭議與 reversal | 任意規則引擎、多層獎金樹、未定義稅務自動化 |
| 通知 | Email delivery closure、LINE OA 需求驗證、交易／營運通知 | 先做 LINE Login、複雜跨通道旅程 |
| 直播 | replay attribution policy、成效報表、低風險互動 | 抽獎／紅包等高政策與反作弊成本功能 |
| 平台擴張 | 依客戶需求加入第二個正式 provider | 為了「看起來完整」先做多金流與 workflow engine |

## 九、路線圖的衡量方式

### 短期 release／信任指標

- CAT04 的 payment outcome 可由受控 evidence 完整對帳；任何未知狀態仍維持 false／NO_GO。
- 付款、退款、webhook、tenant isolation、migration／recovery 與安全掃描沒有被文件敘述掩蓋的失敗。
- 最低錯誤觀測與客服 escalation 可由 owner 依 SOP 執行。

### 中期產品指標

- 設計合作夥伴 7 天啟用率至少 60%。
- 首次可預覽／可發布流程中位時間以 90 分鐘為初始目標。
- 至少 40% 完成者能建立第二條流程，驗證模板與團隊複製不是一次性 demo。
- 夥伴能自行回答「誰帶來哪些點擊、名單、成交與退款」，不需要人工拼多份表格。

### 長期商業指標

- 第二個 payment provider、LINE、workflow 或進階互動都必須有明確客戶需求、成本／風險估算與 owner。
- 組織模板、排行榜與組織間結算能在不破壞 tenant、ledger、privacy、refund 與 audit invariant 的前提下擴展。
- 真實流量下的 field telemetry 能支持產品決策，而非只依賴 synthetic 或 local evidence。

## 十、文件與證據邊界

本報告的現況校正，主要依下列專案文件；若本報告與後續 canonical current evidence 不一致，應以 current evidence 為準：

- [文件權威與時效地圖](DOCUMENT_AUTHORITY.md)
- [Current readiness snapshot](launch/current-readiness-snapshot-20260802.md)
- [Requirements traceability](codex-goal/REQUIREMENTS_TRACEABILITY.md)
- [Manual actions](codex-goal/MANUAL_ACTIONS.md)
- [Decisions needed](codex-goal/DECISIONS_NEEDED.md)
- [Cloudflare-first Live Commerce MVP Report](live-commerce-mvp-report.md)
- [Team Funnel Replication](team-funnel-replication.md)
- [受眾與市場定位](marketing/audience-and-positioning.md)
- [90 天上市前行銷計畫](marketing/go-to-market-90-day-plan.md)

Perplexity 的文字是外部 review input，不是 repository 的 canonical status。任何「已完成」、「PASS」、「可正式上線」或「可正式收款」的說法，都必須回到對應的 dated evidence、外部 provider receipt、政策責任或 owner decision 查證。

## 十一、下一步建議

1. 由 owner 先確認 S1 的 non-Production evidence scope 與 S5 的產品決策清單。
2. 以 S2、S3 各建立一個 bounded work package，分別驗證 first-live 與 finance／support 操作閉環。
3. 90 天內以 3–5 組設計合作夥伴驗證 M1／M5，而不是先承諾多金流、workflow 或進階互動。
4. 每個 checkpoint 只更新實際 evidence、未完成風險、回滾方式與下一個最高價值工作；不以分數或頁面數量代替 release decision。
