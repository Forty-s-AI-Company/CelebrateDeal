# CelebrateDeal 領域工作流程

這份文件承接 `bf45235f8b10fa1fded2da0a4c079e5b883cfef0` 的六個專案技能與領域參考。它補充產品驗收需求；模型、fallback、dispatch、ownership 與授權沿用 [workflow-policy.md](workflow-policy.md)、[ROUTING.md](ROUTING.md)、[handoff-schema.md](handoff-schema.md) 及唯一 [routing-policy.json](../../.ai-team/config/routing-policy.json)。技能只提供薄入口，不啟動團隊或排程。

依任務讀取對應段落，核對目前程式與資料契約。歷史規格或成功收據不能證明本次版本已交付。

## 產品與角色

每個流程明確記錄 actor、tenant、入口、權威資料、狀態轉換、失敗／續行／退款／逾期／取消、audit 及外部相依。跨模組時對照現行 [API 契約](../codex-goal/API_CONTRACT_REGISTRY.md)、[Prisma 不變量](../codex-goal/PRISMA_INVARIANTS.md) 與 [工作矩陣](../remaining-capabilities-work-matrix-20261005.md)，再決定是否增加抽象。

| 角色 | 可用範圍 | 必須驗證的界線 |
| --- | --- | --- |
| Platform admin | 平台帳務與明確授權的全域維運 | MFA、audit；不得冒用商家活動 |
| Organization owner | 自己的商家、成員、商品、直播與帳務 | 另一租戶不可讀寫 |
| Instructor／upline | 明確授權的課程、直播、商品與推薦政策 | 不可修改平台結算規則 |
| Promoter／downline | 自己的推薦連結與允許的 storefront override | 轉換後不得改佣金快照 |
| Staff | 明確授予的功能 | 不推定 owner／finance 權限 |
| Visitor／buyer | 公開互動及已購買的權益 | 不可存取後台、私人分析或他人的訂單 |

區分 live、scheduled prerecorded、VOD、preview 與 published；區分 visitor、lead、click、checkout、paid、refund、commission、payout。官方／AI／system 互動角色必須揭露，不能假扮真人觀眾。外部 storefront 流程依序使用有效 promoter URL、vendor default URL、click event；只有 API、webhook、核准匯入或 reconciliation 的訂單證據可計入 conversion。

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

對帳必須一致：`refundedAmount = sum(valid RefundRecord)`；`net commission = positive commission + void/negative adjustments`；`settlement payable = collected - refunds - fees - commissions + adjustments`。以目前資料模型的單位與唯一鍵實作，不用文字公式取代 ledger 驗證。

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

視覺與 responsive 變更檢查 Chromium 與相關 390×844、768×1024、1280×800、1440×900 viewport；重大 UI 變更另驗 keyboard、a11y、clipping／overlap／內容密度。一般與受控 browser runner 沿用現行 [playwright.config.ts](../../playwright.config.ts) 和 [CI](../../.github/workflows/ci.yml)，必要時使用既有 scoped disposable runner。

證據記錄 `scenario | role | viewport | data state | result | revision/head | evidence | issue`，區分本機合成、外部 Sandbox 與 Production。問題回報附 severity、重現步驟、expected／actual、owner 及必要 console／network 證據；只存有界、去識別分類，不保存 raw log、URL query、header 或 payload。敏感旅程關閉可能保留 token／cookie／payload 的 trace／screenshot／video，改存有界且去識別的狀態；只有已確認不含敏感資訊的視覺 fixture 才保留影像。不得停用 assertions、盲改 snapshot、重試掩蓋固定失敗或把 external-required 改成 PASS。

## 設計與互動

先定義頁面受眾、單一主要工作、資料密度與 mobile workflow；重用目前 [ui.tsx](../../src/components/ui.tsx)、[globals.css](../../src/app/globals.css) 的元件與 token。定義 default、hover、focus-visible、disabled、loading、empty、error、success、selected，再做視覺調整。

後台保持中性、清楚、適當資訊密度；橘／紅橘／金保留給 conversion、urgency、success 或主要動作。文字使用自然繁中、舒適行高與直接動詞。不要無產品理由加入紫藍漸層、發光裝飾、玻璃效果、巨大圓角、巢狀卡片、emoji icon 或競爭的主要 CTA；mobile 不能只是縮小 desktop。

驗證 hierarchy、label／metadata、table scanning／filter／pagination／empty／error、form recovery、visible focus／current／live semantics、contrast 及 reduced motion。動畫用於說明狀態；慶祝需真實確認事件及既有使用者授權。沒有實際驗證不能宣稱 a11y／responsive 完成。

## 驗收與交付

先核對 git scope、migrations、secret／tenant／payment／commission／idempotency／audit、對應 unit／integration／DB／browser／build／preflight 與 unresolved findings。每次證據綁目前 revision/head，保留所有失敗與歷史 checksum。外部 provider 缺證據就明確 blocked，不以 mock 或本機 demo 代替真實 Sandbox 成功。

READY 只能來自既有 MCP `assess_task` 或同一 `assess_acceptance` gate；這份文件、技能與模型回應都不能另行核准。受保護 PR 需必要 independent review、精確 head CI、expected-head squash 與已驗收 tree 比對。不得自行核准未審查的 security／payment／DB 變更。Production、正式 DB／付款／退款／寄信仍需要另外明確授權。

交付回報包含 scope、已通過與失敗的 gate、證據、外部相依、forward migration 與可恢復方式、必要 review、實際下一步與 owner；不要把未驗證配置或 requested/resolved model 當成 observed。
