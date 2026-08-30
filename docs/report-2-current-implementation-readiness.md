# 報告 2｜目前 CelebrateDeal 實作可用性與缺口

> 稽核目的：依照報告 1 的聯盟行銷、外部產品導流、課程分潤與 Stream 用量規則，對照目前工作區程式、Prisma schema 與既有稽核文件，判斷哪些可以使用、哪些只能展示流程、哪些尚未完成。
>
> 判讀基準：只把目前程式與既有測試／稽核文件能證明的能力列為已具備；沒有把資料表名稱或 seed 方案描述當成已完成商業功能。

## 一、總結判定

目前專案是「部分可用」，不是「已完成報告 1 所有功能」。

### 可以使用或已有可驗收基礎

- 商家自己的產品 affiliate：已有 click、推薦碼、checkout 歸因、paid webhook 建立直接 affiliate commission，以及退款／爭議 ledger 的基礎流程。
- 團隊漏斗的核心：A 原始模板、不可變版本、B 自己的 PartnerFunnelPage、B 可編輯未鎖定欄位、公開頁、click／lead／paid conversion attribution 與 A／B 成效報表已有實作與稽核證據。
- 外部產品導流的 click／報名追蹤：可以作為導流工具使用，但外部付款與外部佣金不在 CelebrateDeal 內完成。

### 尚不能宣稱已完成

- CelebrateDeal 自己的方案聯盟行銷：FIN-14 已補上獨立的 platform referral code／click／subscription attribution snapshot domain；FIN-15 補上只接受 server-created pending `PaymentTransaction` trusted metadata 的 verified paid callback、獨立 commission 與 partial/full refund ledger；FIN-16 補上 owner/month payout read model、local batch 與 finance-admin outcome；FIN-17 補上 pending platform subscription checkout 與 trusted paid／failed／refunded subscription state transition。外部出款、KYC／稅務、staging／PayUni 與人工簽核仍未完成。
- 課程 F／G 分潤：目前沒有可證明的課程 owner／實際 promoter allocation、80／20 規則、F 100% 直購規則、課程分潤 payout 與分潤退款回沖讀模型。
- B 的 Stream 額度：本機已新增 server-validated immutable playback usage ledger，能把 B 公開頁的有效播放 heartbeat snapshot 到 page／team／promoter／content owner／live／month，且月結會讀取 ledger；但 owner／promoter／split／custom 政策、quota enforcement 與 provider reconciliation 仍未完成。
- 整體正式商業上線：目前 readiness snapshot 仍標示 `PRODUCTION_READY = false`，法務、隱私、客服、sandbox/staging reconciliation 等仍不能被忽略。

## 二、功能對照表

| 報告 1 需求 | 目前狀態 | 目前證據 | 可否直接作為正式功能 |
| --- | --- | --- | --- |
| CelebrateDeal 方案推薦連結 | 本機 commission／refund／payout read model／batch 完成，外部證據未完成 | `/r/[code]` 建立 server-side click；verified paid webhook 只接受 server-created transaction metadata，寫入獨立 commission／ledger；owner/month payout sync、local batch、paid reference／void reversal 與 audit 已有；與商家 `Affiliate` 分離 | 否 |
| 方案頁推薦人 ID／名稱唯讀欄位 | 尚未完成 | 目前沒有可證明的 platform referral UI、direct-entry 狀態或唯讀推薦人顯示 | 否 |
| 直接輸入平台網址後不沿用推薦人 | 尚未完成／需調整歸因規則 | 現有 checkout 會使用伺服器驗證的 click／cookie；若既有 A cookie 仍有效，可能仍歸 A，與報告 1 採用的 direct-entry 空白規則不同 | 否 |
| 商家產品 affiliate click | 可用／已有基礎 | `Affiliate`、`AffiliateClick`、推薦碼與 click 歸因存在 | 可作商家產品功能使用，仍需依正式環境驗收 |
| 商家產品 checkout 歸因 | 可用／已有基礎 | checkout 會使用伺服器驗證的 affiliate click／cookie，不信任 client referral code | 可以作為現有產品 affiliate 基礎 |
| 商家產品 paid commission | 可用／已有基礎 | paid webhook 依直接 affiliate 與比例建立一筆 `AffiliateCommission` | 不是課程 F／G 分潤，也不是 CelebrateDeal 方案推薦 |
| 商家產品退款／拒付調整 | 部分可用 | 既有 affiliate commission ledger 有 refund、reversal、dispute 類型 | 只涵蓋既有 affiliate commission domain |
| A 建立研討會與原始模板 | 可用 | `TeamFunnelTemplate`、不可變 version、Live／webinar 歸屬與受控分享 | 核心流程可用 |
| B 取得 A 的研討會副本 | 可用 | `PartnerFunnelPage` 以 B 為 promoter、A 為 content owner | 核心流程可用 |
| B 修改自己的推廣頁 | 可用但有欄位限制 | B 可編輯自己的頁與未鎖定欄位；A 原始版本受保護 | 符合目前需求 |
| B 分享自己的外部產品連結 | 部分可用 | 公開頁有 product slot／partner referral code；外部付款不在平台內 | 可導流，不能宣稱外部成交已結算 |
| OO 外部公司上線業績 | 外部依賴 | Team attribution 可以保存 leader／promoter／content owner snapshot，但不計算 OO 獎金 | 正確邊界，非平台缺陷 |
| 課程 F 直接成交 100% | 尚未完成 | 目前沒有課程專用 allocation rule／owner payout path | 否 |
| 課程 G 成交 F 80%／G 20% | 尚未完成 | 目前 `AffiliateCommission` 是單一 affiliate recipient；未見課程 F／G allocation model | 否 |
| 課程不產生 H／不向上線延伸 | 規則尚未落地 | Schema 有 team relationship，但沒有課程分潤規則來限制 recipient scope | 需補規格與程式防線 |
| 分潤按售價，旁邊顯示淨額參考 | 尚未完成 | 現有 billing settlement 有金流／退款／佣金彙整，但沒有課程設定頁的 gross commission base 與 net reference 明細 | 否 |
| 課程退款按 F／G allocation 回沖 | 尚未完成 | 既有 direct affiliate 有退款 ledger；未見課程 allocation 回沖 | 否 |
| B 的 Stream 用量歸屬 | 本機功能閉環／外部對帳待完成 | `StreamUsageLedgerEntry` 由播放 heartbeat 經 server 驗證後保存 immutable attribution snapshot；settlement 讀取 page/member ledger，既有 `UsageRecord` 仍保留 vendor aggregate | 尚不能宣稱完整 quota／provider 對帳 |
| 研討會 owner／promoter／split／custom 用量設定 | 尚未完成 | 目前沒有對應的研討會用量政策與 allocation 設定 | 否 |
| 團隊成員邀請、上下線管理 | 尚未完成 | `SalesTeam`、`TeamMembership`、`TeamMembershipRelationship` schema 存在，但既有稽核列為缺口 | 否 |
| 完整團隊分潤與 payout 報表 | 尚未完成 | 目前團隊報表是 click／lead／conversion／退款成效，不是 F／G 金融分配讀模型 | 否 |

## 三、目前已經做得到的部分

### 3.1 商家直接 affiliate：不要誤認成平台方案聯盟

目前程式已有一套商家產品 affiliate：

- `Affiliate` 有 vendor、code、commission rate、啟用狀態。
- `AffiliateClick` 保存 vendor、affiliate、live、referral code、visitor 與轉換時間。
- checkout API 會從 server-side click／cookie 驗證 affiliate，而不是直接相信前端送入的 referral code。
- paid webhook 可以依 affiliate 與比例建立單一 `AffiliateCommission`。
- `AffiliateCommissionLedgerEntry` 可保存 accrual、refund、reversal、dispute 等金融事件。
- `AffiliatePayout` 有以 affiliate／月份彙整 payout 的資料模型。

這條路徑可支援「某個商家用 CelebrateDeal 賣自己的產品，給某個直接 affiliate 佣金」。FIN-14 另外建立 `PlatformReferralCode`、`PlatformReferralClick` 與 `PlatformReferralAttribution`，FIN-15 接上 trusted server-created payment transaction 的 paid callback 與退款回沖，FIN-16 再以獨立 `PlatformReferralPayout`／batch 做 owner/month payable read model 與人工 outcome，FIN-17 將平台方案選擇接到 server-created pending transaction、provider checkout session 與 subscription activation，不會把方案推薦誤寫入商家 `AffiliateCommission`。目前仍缺外部出款／KYC／稅務與外部環境對帳。

### 3.2 團隊漏斗：A／B 頁面與歸因基礎已存在

既有 `docs/team-funnel-replication.md` 的稽核結論指出，團隊漏斗核心已具備：

- A 建立並發佈不可變模板版本。
- B 取得受控分享，建立自己的 PartnerFunnelPage。
- B 可編輯自己的未鎖定內容與商品槽覆寫。
- 公開頁呈現 B 的頁面與 A 的研討會。
- click、lead、paid conversion 會保存 A／B／內容／研討會歸因 snapshot。
- A、B 可以看到受限的成效報表。

這與你目前的需求相符：B 不能改 A 的原始研討會，但能改自己的推廣頁。

### 3.3 外部產品：平台角色目前比較接近「導流工具」

目前公開頁會解析 B 的 partner profile、外部 product URL、referral code 與 webinar。這足以支援：

1. B 有自己的分享頁。
2. 客戶從 B 頁面報名或點擊產品連結。
3. CelebrateDeal 保存 B 的推廣歸因。
4. 客戶離開 CelebrateDeal 後，OO 直銷／微商／電商自行處理付款與獎勵。

這個邊界本身是合理的。真正要小心的是 UI 與報表不要把「外部點擊」寫成「CelebrateDeal 已成交」，否則商家會以為平台提供了外部金流對帳。

## 四、目前尚未完成或不符合需求的部分

### 4.1 CelebrateDeal 方案聯盟行銷尚未閉環

目前 `BillingPlan` 與 `VendorSubscription` 能處理商家選擇平台方案與用量限制；FIN-14／FIN-15 已把平台推薦 attribution、trusted paid callback、commission snapshot 與 refund ledger 放在獨立 domain。尚待補足的是：

- 方案佣金規則已採首購 only：每個新訂閱首次成功付款才產生一筆；同一訂閱續費不再產生推薦佣金，並由 `PlatformReferralCommission.subscriptionId` unique constraint 防止競態重複。
- cancelled／chargeback 的平台專用事件與回沖政策。
- 平台推薦者的最低付款門檻、KYC／稅務狀態與外部出款資格。

因此目前不能只因為有方案頁、本機 callback 或 local batch，就說「幫賣 CelebrateDeal 已完成」。FIN-17 已完成本機付款 initiation 與 trusted callback state transition；要完成報告 1 的方案聯盟，仍需要外部出款／對帳、KYC／稅務與人工財務／release 授權；不能把商家產品 affiliate 的資料直接套過來。

另外，報告 1 已採用「當次進入來源優先」的產品決策：客戶若後來直接輸入平台網址，推薦人欄位要空白，本次不自動歸給 A。現有 checkout 的 affiliate attribution 會讀取有效 click／cookie，因此若舊 cookie 在 direct entry 後仍被沿用，可能與新規則不一致。正式實作時要加入明確的 direct-entry 狀態／token，並讓推薦人顯示、付款歸因與佣金結果三者一致。

### 4.2 課程 F／G 分潤尚未完成

目前 schema 裡的 `AffiliateCommission` 主要是：

- 一個 `affiliateId`。
- 一個 commission rate。
- 一個 commission amount。
- 一筆直接 affiliate 的結算關聯。

但課程需求至少需要同時保存：

- 課程產品與版本。
- F 課程 owner。
- G 實際 promoter；F 直購時 promoter 為 null 或特殊 direct 值。
- 本筆訂單使用的分潤規則版本。
- gross commission base。
- F allocation 與 G allocation。
- 每個 allocation 的 refund／dispute／payout 狀態。
- 不向 H 或上線延伸的 recipient scope。

目前有 `TeamMembershipRelationship`，不代表課程分潤已經會沿著關係發錢；反而應該明確禁止課程分潤自動遍歷 relationship。課程模型只需要 F 與實際 G，H 不屬於這筆課程訂單。

### 4.3 Stream 額度：內部 attribution ledger 已建立，政策與 provider 對帳仍待完成

既有 `UsageRecord` 仍以 `vendorId`、月份、record type 與 aggregate totals 保存用量，`VendorUsageLimit` 也以 vendor 為唯一範圍。這輪新增 `StreamUsageLedgerEntry` 作為內部 immutable 子帳本：播放端每累積最多 60 秒送出 bounded heartbeat，server 重新驗證 vendor／live／可播放狀態／公開 page，並把 team、template version、promoter、content owner 與月份 snapshot 寫入 ledger。billing settlement 會讀取同 vendor／month 的 ledger seconds，轉成分鐘後與既有 aggregate 取較高值，避免重複計費。

因此本機現在可以回答「某個合法 playback event 歸屬哪個 page／member／live／month」，也可以將 ledger 秒數納入本機月結；但尚不能宣稱完整的商業 quota policy。仍不能可靠回答：

- 這 1,000 分鐘中，有多少來自 A？
- 有多少是 B 的推廣頁帶來？
- B 額度用完要阻擋、超額收費還是回到 A？
- 一場研討會使用 `OWNER`、`PROMOTER`、`SPLIT` 還是 `CUSTOM`？

所以 B 負擔自己的觀看額度目前是「已具備可追溯內部 ledger、尚未完成政策執行與外部對帳」的本機功能。外部 Cloudflare 的實際帳單仍可能在同一個 Cloudflare account 層級發生；正式上線前還需要定義 owner／promoter／split／custom policy、quota exhaustion／overage 行為，並以 provider evidence 對帳 internal allocation。

### 4.4 B 播放路徑可能造成後續歸因遺失

目前 `src/lib/team-funnel-public-page.ts` 的 B 公開頁：

- 報名留在 B branded page，設計上能保留同源 Referer 與 B 頁面歸因。
- `playbackHref` 指向共用 `/live/{live.slug}`，並攜帶伺服器解析的 `sourcePage` 與有效 `ref` 線索。

本輪已修正原本跨頁即遺失 B page lineage 的本機功能缺口：`LivePlayback` 會把 `sourcePage` 送到 click endpoint，伺服器再以 vendor、live、公開頁與 active membership 關聯驗證，不接受 client owner 權限宣告。這仍不是完整的外部付款驗收；B 頁面 → 播放 → 報名 → 付款的 staging／PayUni end-to-end evidence 尚未取得。

建議：

- 若要把首次 click 提升為財務級證據，再評估簽名、短效 attribution token 或 B 專屬 playback session；目前 `sourcePage` 只作伺服器驗證前的 lookup clue。
- 報名與付款都只接受 server-side 可驗證的 page／lead snapshot。
- 增加「B 頁面 → 播放 → 報名 → 付款」完整流程測試，不只測 B 頁面本身。

## 五、最可能造成實際爭議的程式缺口

| 優先級 | 缺口／Bug | 目前判斷 | 實際後果 |
| --- | --- | --- | --- |
| P0 | 方案推薦與商家產品 affiliate 未分 domain | FIN-14～FIN-16 已完成本機 domain boundary、verified callback、commission／refund ledger、owner/month payout read model、local batch 與人工 outcome；外部驗證仍待 | 平台 referral 不再依賴 vendor affiliate 表；本機可追蹤 paid／refund／payout claim，但尚不能宣稱外部出款或正式商業結算 |
| P0 | 課程沒有 F／G allocation 與 payout ledger | FIN-11 已完成本機 allocation／append-only refund-dispute ledger；merchant-owned payout、KYC、稅務與人工出款仍待 | 本機已能可靠 snapshot、退款與稽核；外部付款與真人出款證據仍不可宣稱 |
| P0 | 課程沒有 direct F 100% 規則 | FIN-11 本機已修正 | F 直購只建立 F 100%，不產生不存在的 G 分潤；外部 staging／PayUni 尚待 |
| P0 | Stream 沒有 B／page 用量子帳本 | 本機 ledger 已完成；quota policy／provider reconciliation 待完成 | 平台已有可追溯 page/member attribution 與 settlement input，但尚不能宣稱 B quota enforcement 或 provider bill reconciliation |
| P1 | B 播放跳到共用 `/live` | 已修正本機 lineage；外部完整流程待驗收 | 來源頁現在會隨播放 URL 傳遞並由伺服器驗證；尚未取得 staging／PayUni 的報名／購買閉環證據 |
| P1 | 外部付款沒有可信 callback | 設計邊界 | 只能報 click／lead，不能報外部已成交或外部退款 |
| P1 | 團隊關係 schema 有，但邀請／轉組 UI 不完整 | 已列為既有 gap | 無法穩定管理誰是 F 的 G，也難以撤銷推廣權 |
| P1 | 退款回沖只覆蓋既有 direct affiliate | FIN-11 已擴充本機課程 allocation ledger | F／G 本機退款會依原 snapshot 回沖；外部 payment reconciliation 與出款仍待 |
| P1 | gross 與 net 參考值沒有分離 | 尚未完成 | F 以為按售價分潤，實際卻被金流費／稅額暗扣 |
| P2 | first-touch／last-touch 沒有正式商業規則 | 需要產品決策 | A、B 之間會爭議同一客戶到底算誰的 |
| P2 | 自購、重複 webhook、跨租戶與離隊規則需逐一驗證 | 部分已有基礎、課程未覆蓋 | 可產生重複佣金、無效佣金或錯誤歸因 |
| P2 | payout、KYC、稅務資料未完成 | readiness／營運缺口 | 有計算結果但不一定能合法或實際付款 |

## 六、建議實作順序

### Phase 1：先把三個 domain 分開

建議不要直接擴充現有 `AffiliateCommission` 來包辦所有事情。至少要在業務層分開：

1. `PlatformReferral`：推薦 CelebrateDeal 方案的 click、訂閱訂單、推薦規則 snapshot、平台佣金與 payout。
2. `MerchantAffiliate`：現有商家產品 direct affiliate。
3. `CourseCommissionPolicy`：F 對課程設定的分潤規則與版本。
4. `CourseCommissionAllocation`：每筆課程訂單的 F／G allocation、退款／拒付／結算狀態。
5. `StreamUsageAllocation`：vendor、member、page、live、觀看 session、分鐘、政策與超額狀態。

名稱可以依現有 schema 調整，但不能只依 `Affiliate` 這個模糊名稱判斷來源。

### Phase 2：完成課程 F／G 分潤

最低可上線範圍：

- F 建課程並設定 F／promoter 比例。
- 直接由 F 成交時 F 100%、不產生 G。
- 由 G 成交時只產生 F／G 兩筆 allocation。
- 比例以 basis points 保存，總和必須為 10000。
- 付款時 snapshot 課程、F、G、比例、金額、幣別與規則版本。
- paid webhook 冪等建立 allocation。
- partial/full refund、dispute 產生負向 ledger。
- F／G 的 payout 權限、最低金額、收款資料與人工鎖帳狀態清楚可見。
- UI 分開顯示 gross commission base 與扣費／稅／退款後的 net reference。

### Phase 3：完成平台方案聯盟

- 方案頁產生平台推薦連結，而不是把商家產品 referral code 塞進方案購買流程。
- 訂閱首購與續費規則明確。
- platform referral click 綁定 user／visitor、有效期限與推薦條款版本。
- FIN-14～FIN-17 已完成 click／attribution snapshot、server-created payment metadata gate、pending platform subscription checkout、trusted paid／failed／refunded state transition、paid commission／partial-full refund 專用 ledger、owner/month payout read model、local batch 與 finance-admin paid／void controls；續費已採首購 only，cancelled／chargeback 仍需完整外部對帳與人工財務規則。
- 下一段需完成外部出款資格／KYC／稅務、staging／PayUni reconciliation 與人工 owner／legal／finance／release approval，並與商家產品 payout 分開。

### Phase 4：完成 B 的 Stream 內部用量

- B 頁面播放 heartbeat 已生成 server 可驗證的 attribution，並以 immutable `eventId` 防止同一事件重複入帳。
- 目前 ledger snapshot 已保存 owner／promoter 的可追溯欄位；owner／promoter／split／custom 的政策選擇與 enforcement 仍待產品設定。
- 每次有效 heartbeat 寫入 member／page／live／month ledger，並由 settlement 讀取；不能只保留 vendor total。
- 明確定義額度用完、超額、回退與通知。
- 對帳時顯示「Cloudflare provider usage」與「CelebrateDeal internal allocation」兩個層級。

### Phase 5：補完整驗收

需要至少有以下 deterministic tests：

- F 直接成交 → F 100%，G／H 0。
- G 成交 → F／G 依比例，H 0。
- G1／G2 不互相分潤。
- 比例總和非 100% → 拒絕儲存。
- gross 分潤與 net reference 不混算。
- 全額／部分退款 → F／G 各自按原 allocation 回沖。
- paid webhook 重送 → 不重複 allocation。
- F 改比例 → 歷史訂單不變。
- B 頁面 → playback → registration → checkout → paid conversion，B attribution 不丟失。
- A 直接觀看與 B 推廣觀看 → 依 Stream policy 分到正確 recipient。
- 外部 checkout → 只有 outbound click／registration，不產生 CelebrateDeal paid commission。
- 跨 vendor、無效 membership、離隊成員與過期 share → fail closed。

## 七、目前是否可以使用：最後判定

### 可以對外展示／試用的範圍

- A 建立研討會與團隊模板。
- B 取得自己的推廣頁，編輯授權欄位。
- B 分享頁面，記錄 click、報名與團隊成效。
- 以外部產品連結導流，並清楚標示外部付款與外部獎勵由外部公司處理。
- 既有商家產品 direct affiliate，在既有 payment webhook／commission 流程範圍內試用。

### 目前不建議宣稱已可用的範圍

- 「推薦 CelebrateDeal 方案可以拿平台佣金」：本機 callback／退款 ledger／payout read model／batch 已存在，但實際付款 initiation、外部出款、KYC／稅務、外部對帳與人工簽核尚未形成完整閉環。
- 「課程可以設定 F 80%、G 20% 並自動結算」：尚未完成。
- 「B 分享 A 的研討會，Stream 額度自動算到 B」：本機已有 per-page／per-member ledger attribution 與 settlement input，但 quota policy、provider reconciliation 與外部 evidence 尚未完成。
- 「外部產品已成交、退款與外部組織獎金都可在 CelebrateDeal 對帳」：目前不成立。
- 「整個平台已達正式商業上線」：目前 readiness snapshot 仍是 production not ready。

### Go／No-Go

| 上線目的 | 判定 |
| --- | --- |
| Demo 團隊漏斗、B 推廣頁、研討會報名與 click 追蹤 | Go，需依既有範圍與測試證據使用 |
| 外部產品導流工具 | Conditional Go，必須清楚標示外部付款與外部佣金不由 CelebrateDeal 計算 |
| 商家自己的 direct affiliate | Conditional Go，限於現有 affiliate payment／refund／payout domain，仍需環境驗證 |
| CelebrateDeal 方案聯盟行銷 | Partial local closure；平台推薦、pending subscription checkout、trusted subscription activation、verified commission／refund ledger、payout read model／local batch 已完成，外部出款、staging／PayUni 與人工 sign-off 仍 No-Go |
| F／G 課程分潤 | Partial local closure；allocation、規則 snapshot、退款／dispute ledger 已完成，merchant-owned payout、KYC、人工 owner 與 staging／PayUni 仍 No-Go |
| B 的 Stream 額度歸屬 | No-Go，缺 member／page 用量子帳本與超額規則 |
| 正式商業全面上線 | No-Go，仍有 readiness、法務、隱私、客服與環境驗證缺口 |

## 八、證據索引

以下是本報告主要對照的工作區證據：

- `docs/team-funnel-replication.md`：團隊漏斗已完成能力、A／B ownership matrix、歸因邊界與 TF-GAP-03～07。
- `docs/launch/current-readiness-snapshot-20260802.md`：目前整體 readiness、`PRODUCTION_READY = false` 與法務／營運／環境限制。
- `prisma/schema.prisma:426-557`：`Affiliate`、`AffiliateClick`、`BillingPlan`、`VendorSubscription`、`VendorUsageLimit`、`UsageRecord`。
- `prisma/schema.prisma:805-895`：既有 `AffiliateCommission`、immutable commission ledger 與 `AffiliatePayout`。
- `prisma/schema.prisma:930-1010`：`SalesTeam`、`TeamMembership`、`TeamMembershipRelationship`。
- `prisma/schema.prisma:1094-1260`：`PartnerFunnelPage`、team click／lead／conversion attribution。
- `src/app/api/payments/checkout/route.ts`：checkout 使用伺服器驗證 affiliate click／cookie 與 form submission attribution。
- `src/lib/payment-webhooks.ts:147-290`：直接 affiliate paid commission、去重與退款／ledger 處理。
- `src/lib/platform-referral-commission.ts`、`src/lib/payment-webhooks.ts`：FIN-15 平台推薦 verified paid callback、獨立 commission 與 partial/full refund ledger。
- `src/lib/platform-referral-payout.ts`、`src/app/actions/platform-referral-payout-actions.ts`、`src/app/admin/billing/platform-referral-payouts/page.tsx`：FIN-16 owner/month payout read model、local batch、manual paid／void outcome 與 audit boundary。
- `src/lib/course-commission.ts`、`src/lib/course-commission-accounting.ts`、`src/lib/payment-webhooks.ts`：FIN-11 課程 F/G allocation、policy snapshot 與退款／dispute ledger。
- `src/lib/team-funnel-sharing.ts`：B 建立自己的 PartnerFunnelPage，A 保留 content／webinar owner。
- `src/lib/team-funnel-public-page.ts:147-214`：B partner profile、商品槽、報名 anchor 與共用 playback URL。
- `src/lib/billing.ts`：vendor aggregate usage、月結、金流費、退款與既有 affiliate commission 彙整。
- `prisma/seed.ts:11-69`：目前 seed 的方案與 affiliate 管理費欄位；seed 文字不等同於已完成方案聯盟行銷。
