# CelebrateDeal 領域工作流程

這份文件是 `.claude/skills/celebratedeal-*` 六個專案技能的領域參考，補充產品驗收需求。技能只提供薄入口，不啟動團隊或排程。

依任務讀取對應段落，核對目前程式與資料契約。歷史規格或成功收據不能證明本次版本已交付。

## 產品與角色

每個流程明確記錄 actor、tenant、入口、權威資料、狀態轉換、失敗／續行／退款／逾期／取消、audit 及外部相依。跨模組時對照現行 [API 契約](codex-goal/API_CONTRACT_REGISTRY.md)、[Prisma 不變量](codex-goal/PRISMA_INVARIANTS.md) 與 [工作矩陣](remaining-capabilities-work-matrix-20261005.md)，再決定是否增加抽象。

| 角色 | 可用範圍 | 必須驗證的界線 |
| --- | --- | --- |
| Platform admin | 平台帳務與明確授權的全域維運 | MFA、audit；不得冒用商家活動 |
| Organization owner | 自己的商家、成員、商品、直播與帳務 | 另一租戶不可讀寫 |
| Instructor／upline | 明確授權的課程、直播、商品與推薦政策 | 不可修改平台結算規則 |
| Promoter／downline | 自己的推薦連結與允許的 storefront override | 轉換後不得改佣金快照 |
| Staff | 明確授予的功能 | 不推定 owner／finance 權限 |
| Visitor／buyer | 公開互動及已購買的權益 | 不可存取後台、私人分析或他人的訂單 |

區分 live、scheduled prerecorded、VOD、preview 與 published；區分 visitor、lead、click、checkout、paid、refund、commission、payout。官方／AI／system 互動角色與腳本化虛擬使用者只存在於觀眾端聊天室（2026-10-18 owner 決策，允許不標示的虛擬觀眾帳號）；它們的發言、觀看與互動不得計入商家後台的報名、訂單、付款、成效統計或任何 conversion。外部 storefront 流程依序使用有效 promoter URL、vendor default URL、click event；只有 API、webhook、核准匯入或 reconciliation 的訂單證據可計入 conversion。

### 指定場次（fixed sessions）

一場預錄直播（VOD、非常青、影片長度已知）可設多個開播時間（`Live.sessionMode = fixed_sessions`，`LiveSession` 列）。權威資料與規則：

- **報名與名額**：報名者在報名頁選一個場次（`liveSessionId`）。送出當下以條件式 UPDATE 佔位（`open`、未過開始時間＋截止分鐘、未額滿）；同一 IP 對同一場次另有限流。未在 48 小時驗證期限內完成 Email 驗證的報名，名額由 email job 或過期連結的驗證請求釋放一次（`liveSessionSeatReleasedAt`）；之後以同一 Email 重新報名會重新佔位並寄出新的驗證信。
- **換場次**：以同一 Email 重新報名、選另一個場次時，只在原場次尚未開始（或已取消）時才換；已驗證的報名還必須是原瀏覽器（持有該筆報名的簽章 cookie），或原場次已取消。只知道 Email 不能移動已確認的報名。換不了場時，原瀏覽器收到 409 並被告知目前的場次（「你已報名 {日期時間} 場次」）；其他人得到與全新報名完全相同的回應（目標場次可報名時是一般的成功與「請查看確認信」，額滿或關閉時是同樣的錯誤），真正的報名者則收到一封通知「你已報名 X 場；如需換場請在原裝置操作」。因為任何知道 Email 的人都能觸發這封信，它不是免退訂的服務通知：信中附退訂連結，名單退訂（`recipient_request`）、退信／投訴與黑名單都會擋（建立時與寄送前各查一次）；同一筆報名對同一個要求的場次最多一封，整筆報名最多三封（以每筆報名的 advisory lock 計數，併發也不會超過）。**已接受的剩餘風險**：直接呼叫 API 的人仍能從 Set-Cookie 分辨全新報名與被隱藏的重複報名——全新報名會設定感謝頁結果 cookie 與既有的 LINE 綁定 capability cookie，重複報名兩者都不設；HttpOnly 只擋得住頁面腳本，擋不住 raw API 呼叫者。這個差異以既有的每 IP 限流（每分鐘 10 次、每場次 10 分鐘 5 次）減緩，不宣稱能完全防止以 Email 探測報名狀態。並行變更造成換場失敗時回 503 請對方重試，不顯示假的成功。感謝頁的場次只來自伺服器簽章、HttpOnly 的結果 cookie（`/lp` 頁面在伺服器端驗章並比對 liveId），沒有它時只顯示中性的「請查看確認信」；JSON 回應只對原瀏覽器附上場次。無 JavaScript 的表單重試以加密 draft 的 reason 區分「已報名其他場次」與「場次額滿或關閉」。場次取消後完成驗證的報名者，驗證頁的重選連結由伺服器依簽章 cookie 解析，不接受網址參數。換場後提醒改依新場次排程，舊場次未寄出的 Email／LINE 提醒取消。
- **取消場次**：Studio 移除有報名的場次時改為取消，不刪報名。未寄出的提醒（Email live_reminder、before_live、during_live、LINE live_reminder）在同一交易取消；每位已驗證報名者收到一封「你報名的場次已取消，請重新選擇場次」，連結依序為公開可用（含專案已發布）的一頁式網站、報名表、直播觀看頁。在取消後才完成 Email 驗證的報名者，收到的是這封取消通知而不是確認信，驗證頁也提示重新選擇。這封信屬交易型服務通知：平台固定文案、無行銷內容、無退訂連結；商家名單退訂（`recipient_request`）不擋，黑名單與退信／投訴類停寄仍擋。重新加入相同時間即恢復該場次。
- **時間**：確認信、提醒、課後通知（場次開始＋影片長度＋規則分鐘數；只寄給實際播完的場次：直播被改回草稿後不再寄，商家結束直播時只寄 `endedAt` 前已播完的場次）、觀看頁倒數與播放位置、admission 與回放期限都依報名者的場次。漏斗的共用開始／結束時間不擋指定場次直播的播放入口（與常青相同，交給觀看頁）。指定場次直播不能手動「開始直播」，也不發 LINE「直播開始」通知；共用的腳本互動（投票、抽獎）不在指定場次直播執行。
- **換裝置觀看**：觀看頁以報名驗證後設定的簽章 cookie（30 天）辨識報名者。在沒有這個 cookie 的裝置（例如在電腦報名、用手機開信）上，觀看者跟隨公開時程：正在播的場次，否則下一場，最後一場之後則是最近一場的回放。這是 Phase 1 的已知限制。
- **公開回放**：每場回放期限是「場次結束＋`sessionReplayWindowHours`」與直播 `replayAvailableUntil` 中較早者。沒有 cookie 的觀看者在最後一場之後看到的是最後一場的回放，所以任何人在回放開啟期間都能看到回放，不限於報名者；與單一開播時間的直播相同，回放不是報名者限定內容。

## 歸因與佣金

先固定 provider、event ID、order number、pending transaction、vendor、affiliate、product／live、visitor／session 與 attribution record。URL／cookie／session 僅是候選來源，接受的歸因與價格由 checkout 伺服器綁定並凍結。

| 事件 | 前提 | 持久化結果與冪等界線 |
| --- | --- | --- |
| Referral visit | 有效 vendor／affiliate／link、政策窗口內 | candidate／click；visitor＋campaign＋有界時間桶 |
| Checkout | server product／live 與有效 attribution | pending transaction；vendor＋order number，金額及 affiliate 快照 |
| Provider paid | 簽章有效、已知 pending order、幣別及金額相符 | paid 與 eligible commission；provider＋event ID、conversion unique key |
| Partial／full refund | 已知交易、有效退款事件及剩餘可退金額 | RefundRecord 與冪等 void／append-only 負向 adjustment；provider＋refund event ID |
| Chargeback／拒付 | 已驗證 provider 拒付事件、已知原交易與金額 | 冪等 commission void／append-only 負向 adjustment；provider＋chargeback event ID，已鎖結算另追加 adjustment |
| Settlement lock | reconciliation 乾淨、核准期間 | 不可變 settlement snapshot；vendor＋period |
| Payout | 已鎖定且 eligible 的 settlement、核准帳戶 | batch／item state；batch＋settlement |

對帳必須一致：`refundedAmount = sum(valid RefundRecord)`；`net commission = positive commission + void/negative adjustments`；`settlement payable = collected - refunds - fees + adjustments`（D-31 A：聯盟佣金由商家自付，月結**不扣**佣金；`calculateSettlement` 的 `affiliateCommissionCents` 只回報、不扣除，規則與改成平台代扣代付前要補的項目見 `docs/operations/affiliate-commission-settlement-runbook.md`）。以目前資料模型的單位與唯一鍵實作，不用文字公式取代 ledger 驗證。

未知訂單或未驗證 webhook 不可產生權威付款與佣金；client price／vendor／affiliate／rate 不可覆寫 server records。結算鎖定後只追加 adjustment，不改舊 ledger 掩蓋修正。Chargeback／拒付也須核對原交易、佣金與結算調整，不能未經 provider 證據就當成普通退款或重複扣除。回歸涵蓋重複、部分退款、亂序、重複／亂序拒付、過期連結、無效 affiliate、self-referral 政策、provider retry、併發與跨租戶；click-through 不能宣稱收入。

## 租戶與權限

從已驗證使用者、active membership、current vendor、platform role 與 capability 追到最後一個 DB 操作。每個輸入 ID 及 relation connect 必須以 compound ownership predicate 或 server-side ownership check 綁定；不先做 global query 再於記憶體過濾。

| 資料 | 範圍 | 必要負向回歸 |
| --- | --- | --- |
| Product／video／form／live／script／role | vendorId＋feature permission | 外租戶不能 read／connect／mutate |
| Payment account／transaction／refund | vendorId＋實際 finance capability | 外租戶不能 list／export／mutate |
| Settlement／invoice／payout | vendor view；platform 明確 mutation | vendor finance 不能操作全域資源 |
| Affiliate／click／commission | vendorId＋affiliate ownership | referral code 不能跨 tenant |
| Audit／webhook | 平台或租戶範圍、必要去識別 | 不揭露其他 tenant、payload 或 secret |

UI 隱藏不能充當權限。每個新增敏感 read／mutation／export／relation 用第二租戶回歸；拒絕不得洩漏存在性。Schema 變更評估 tenant key、FK、unique、index、既有 RLS 與 forward migration；RLS 是額外防線，不取代 server guard 或 audit。安全、finance、role、ownership 變更須有適當 audit。

## 瀏覽器 QA

風險決定覆蓋範圍，使用固定非 Production 與唯一合成資料。角色涵蓋受影響的 anonymous、owner、staff、finance、platform admin 未驗證／已驗證 MFA；狀態涵蓋 empty、loading、validation／authorization／provider error、success、duplicate、large list、expired session。

驗證實際交付介面、可見結果、URL／state、API 回應及必要 DB 落地；相關情境另檢查 console errors 與 failed network requests。輸入欄位仍有文字不能證明 POST 成功。敏感流程包含登入／return／reset／MFA recovery、建立並發布商品／video／form／script／live、public playback／referral／CTA／lead、server-priced checkout／paid／refund／duplicate callback、vendor read-only finance／platform settlement／payout、跨租戶 ID 竄改。

視覺與 responsive 變更檢查 Chromium 與相關 390×844、768×1024、1280×800、1440×900 viewport；重大 UI 變更另驗 keyboard、a11y、clipping／overlap／內容密度。一般與受控 browser runner 沿用現行 [playwright.config.ts](../playwright.config.ts) 和 [CI](../.github/workflows/ci.yml)，必要時使用既有 scoped disposable runner。

證據記錄 `scenario | role | viewport | data state | result | revision/head | evidence | issue`，區分本機合成、外部 Sandbox 與 Production。問題回報附 severity、重現步驟、expected／actual、owner 及必要 console／network 證據；只存有界、去識別分類，不保存 raw log、URL query、header 或 payload。敏感旅程關閉可能保留 token／cookie／payload 的 trace／screenshot／video，改存有界且去識別的狀態；只有已確認不含敏感資訊的視覺 fixture 才保留影像。不得停用 assertions、盲改 snapshot、重試掩蓋固定失敗或把 external-required 改成 PASS。

### Staging browser smoke（merge queue 流程）

每次 merge queue 合併、Vercel 建好 preview 並把固定 alias 指向該 deployment 之後執行。`<sha>` 為 master 上該 queue commit 的完整 40 碼 SHA，`<host>` 為 Vercel 為該 SHA 建立的 `celebrate-deal-staging-*.vercel.app` immutable host：

```
gh workflow run staging-browser-smoke.yml --ref master -f source_sha=<sha> -f deployment_host=<host> -f surface=fixed_alias
```

lineage 步驟（`node scripts/mvp-payuni-sandbox-e2e.mjs --verify-lineage`）依序驗證：GitHub Deployment 紀錄（environment `Preview – celebrate-deal-staging`）的最新 success status 指向 `<host>` 且 SHA 完全相同；`<sha>` 為 `master` 本身或其祖先（GitHub compare API，不比對分支名稱，因此 `gh-readonly-queue/*` ref 的 deployment 可通過）；`fixed_alias` 對 alias 的 `/api/health` 取得 200。Vercel 防火牆會以 403 拒絕直接探測 immutable host，所以只有 `immutable_preview` 才探測該 host。alias 是否確實指向 `<host>` 由下一步 `--verify-alias`（Vercel API）證明，host 與 SHA 的綁定由前述 Deployment 紀錄證明。

## 設計與互動

先定義頁面受眾、單一主要工作、資料密度與 mobile workflow；重用目前 [ui.tsx](../src/components/ui.tsx)、[globals.css](../src/app/globals.css) 的元件與 token。定義 default、hover、focus-visible、disabled、loading、empty、error、success、selected，再做視覺調整。

後台保持中性、清楚、適當資訊密度；橘／紅橘／金保留給 conversion、urgency、success 或主要動作。文字使用自然繁中、舒適行高與直接動詞。不要無產品理由加入紫藍漸層、發光裝飾、玻璃效果、巨大圓角、巢狀卡片、emoji icon 或競爭的主要 CTA；mobile 不能只是縮小 desktop。

驗證 hierarchy、label／metadata、table scanning／filter／pagination／empty／error、form recovery、visible focus／current／live semantics、contrast 及 reduced motion。動畫用於說明狀態；慶祝需真實確認事件及既有使用者授權。沒有實際驗證不能宣稱 a11y／responsive 完成。

## 驗收與交付

先核對 git scope、migrations、secret／tenant／payment／commission／idempotency／audit、對應 unit／integration／DB／browser／build／preflight 與 unresolved findings。每次證據綁目前 revision/head，保留所有失敗與歷史 checksum。外部 provider 缺證據就明確 blocked，不以 mock 或本機 demo 代替真實 Sandbox 成功。

PR 合併前 CI 必須通過；security／payment／DB 變更另需一次獨立審查（`.claude/agents/reviewer.md`），不得自行核准。Production、正式 DB／付款／退款／寄信仍需要另外明確授權。

交付回報包含 scope、已通過與失敗的 gate、證據、外部相依、forward migration 與可恢復方式、必要 review、實際下一步與 owner；不要把未驗證配置或 requested/resolved model 當成 observed。

## 已接受的殘餘風險

- 直播網址（`Live.slug`）全站唯一。草稿自動存檔與送出時的「直播網址已被使用」提示，會讓任何商家成員得知某個網址是否已被任何租戶使用（只回布林值，不回 id）。這與送出時資料庫唯一鍵衝突本來就能得到的訊號相同；若日後要改成租戶命名空間，另開議題。
