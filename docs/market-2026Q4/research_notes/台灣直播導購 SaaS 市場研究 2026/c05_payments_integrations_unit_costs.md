# 台灣直播導購 SaaS：金流、通知管道、廣告追蹤 API 與基礎設施單位成本（2026Q4 事實檔）

存取日期：2026-10-18（以下「存取日」皆同）。幣別除另有標示外為新台幣（NT$）；美元費率標示 USD。

可信度標籤：
- **[A]** 官方一手來源（官方文件、價目頁、後台 JS 資料）
- **[B]** 具名媒體或官方轉述，需交叉驗證
- **[C]** 廠商部落格／第三方整理，無法確認與官方一致
- **[D]** 低可信（無日期、無出處、AI 整理文件）

稅別標籤：【含稅】【未稅】【未標示】。工具限制說明：PayUNi 官網費用頁與 docs.payuni.com.tw 皆為前端渲染的 SPA，一般網頁抓取只拿到標題；本檔 PayUNi 數字是直接讀取官網前端程式碼與 docs 網站公開 ShowDoc JSON 介面（未登入）取得，已在各條註明。

---

## 1. PayUNi（統一金流）2026 公開費率、結算、限額

### Takeaway
PayUNi 官網費用頁（無日期）公告：國內信用卡／銀聯 2.8%、國外卡 3.5%、7-ELEVEN ibon 超商代碼每筆 25 元、ATM 單繳帳號 1%（最高 15 元）、LINE Pay 為「交易處理費 0.2%」；信用卡與非信用卡皆於請款日／付款日 +7 日入 UNi 帳戶。費用頁沒有標示含稅或未稅，且信用卡 30 天累計額度有上限（個人 20 萬、企業 100 萬），平台代收模式必須事先確認。

### Cited Findings
- 信用卡：國內卡 2.8%、國外卡 3.5%、銀聯卡 2.8%；分期 3 期 2.9%、6 期 3.5%、9 期 4.0%、12 期 6.5%、18 期 9.0%、24 期 11%、30 期 13%。稅別【未標示】。[A] — [PayUNi 費用一覽](https://www.payuni.com.tw/fee)（數值取自官網前端程式碼 https://www.payuni.com.tw/js/app.js，存取日 2026-10-18；頁面無更新日期）
- 超商代碼：僅 7-ELEVEN ibon，每筆 25 元；ATM：單繳帳號（一次性虛擬帳號）1%，最高收取 15 元；稅別【未標示】。[A] — [PayUNi 費用一覽](https://www.payuni.com.tw/fee)（同上）
- 電子錢包：icash Pay 2.5%；街口支付 2.5%（部分高風險產業無法使用或費率不同）；AFTEE 2.5%；LINE Pay 為「交易處理費 0.2%（於交易完成後隔日收取）」。注意：LINE Pay 端另需商家自行向 LINE Pay 申請 Channel ID／Secret，LINE Pay 自身的特店費率不在此頁。[A] — [PayUNi 費用一覽](https://www.payuni.com.tw/fee)；[UPP 2.0 文件](https://docs.payuni.com.tw/web/#/7/34)
- UPP 2.0 文件列出信用卡支援 Visa、MasterCard、JCB、銀聯；Apple Pay、Google Pay、Samsung Pay 皆支援國內外卡（不含銀聯；Samsung Pay 不含 JCB）；Apple Pay／Google Pay／Samsung Pay 的獨立費率在費用頁未列出（見 Gaps）。[A] — [UPP 2.0](https://docs.payuni.com.tw/web/#/7/34)
- 退款：超商代碼與 ATM 轉帳退款每筆 10 元；信用卡退款只能刷退，不提供轉帳退款。手續費「全平台以單筆計收，四捨五入後不足一元以一元計」。AFTEE 退款不返還手續費。[A] — [PayUNi 費用一覽](https://www.payuni.com.tw/fee)
- 撥款至 UNi 帳戶：信用卡 請款日 +7 日；超商代碼 付款日 +7 日；ATM 付款日 +7 日；後支付 付款日 +7 日。再由會員自行提領到綁定銀行帳戶（約 1～3 工作天），提領匯款手續費每月前五次免費，費用頁 JS 資料列「提領匯款手續費 15 元」。[A] — [PayUNi 費用一覽](https://www.payuni.com.tw/fee)；官網 FAQ 資料（同一 app.js）
- 價金保管：官網 FAQ 說明交易款項全額進入中國信託商業銀行信託專戶；UNi 虛擬帳戶餘額超過 365 天未提領且聯繫未果，將收取帳管費（每月按餘額 10%，不足 100 元以 100 元計）。[A] — PayUNi 官網 FAQ（app.js，https://www.payuni.com.tw/js/app.js）
- 額度控管：信用卡近 30 天累計額度上限：個人賣方會員 20 萬、企業賣方會員 100 萬；超過上限該筆交易失敗；可洽客服 02-6605-0810 調整。每月提領額度亦有上限。[A] — [PayUNi 費用一覽](https://www.payuni.com.tw/fee)（額度數字取自 app.js 的 creditLimit 設定，網頁以表格呈現）
- 單筆金額限制：信用卡 1～199,999；ATM 15～49,999；超商代碼 30～20,000。[A] — [交易訂單金額限制說明](https://docs.payuni.com.tw/web/#/7/170)（頁面時間 2025-08-25）
- 優惠費率：第三方整理文件稱「國內卡一次付清 2.4%（原 2.8%）」，需另填優惠申請表單。該文件無日期且連結網域被另一搜尋結果質疑，僅能視為「可議價空間的線索」。[D] — [docs.wpsite.pro 金流申請總資訊](https://docs.wpsite.pro/wp/chuan-jie-jin-liu-wu-liu-dian-zi-fa-piao/jin-liu-shen-qing-zong-zi-xun)
- 官方 docs 站「說明」頁：PayUNi 自稱「提供金流代收服務」，營業人無須向銀行申請，直接透過平台串接；支付方式皆須審核開通（審核商店資料、販售商品、商店網址）。[A] — [PayUNi 說明](https://docs.payuni.com.tw/web/#/7/24)（頁面時間 2026-06-29）；官網 FAQ（app.js）
- 內建電子發票：「提供光貿電子發票功能」，商店於 PayUNi 後台設定後可於每筆交易付款完成時自動／手動開立；舊版 API（1.0、1.1）不支援電子發票。發票費用未於 PayUNi 公開頁揭露。[A] — [PayUNi 說明](https://docs.payuni.com.tw/web/#/7/24)
- PayUNi 後台另有「續期收款」（連結式週期扣款）：週／月／年週期、期數彈性、首期與續期金額可不同、可暫停與重啟；為平台託管的週期性收款，非 Token 幕後授權。費用未公開。[A] — PayUNi 官網「支援續期收款」頁（前端程式碼 https://www.payuni.com.tw/js/app.js 及其 chunk，存取日 2026-10-18）

### Inferences
- 若以公開牌價 2.8% 計，每 NT$1,000 訂單信用卡費用約 NT$28（稅別未標示；若比照綠界／藍新慣例另加 5% 營業稅則約 NT$29.4）。
- 平台代收模式下所有商家的信用卡流水都落在同一個 PayUNi 商店／會員，企業會員 30 天 100 萬額度可能成為成長瓶頸，需在內測前向客服申請調整並書面確認。（推論；官方只說「可洽客服調整」。）

### Gaps
- 費用頁未標示含稅／未稅，也未標示更新日期。
- Apple Pay、Google Pay、Samsung Pay 的獨立費率、Token 幕後授權是否另收費、續期收款手續費、光貿電子發票每張費用，均未在公開頁找到。
- 2.4% 優惠費率的申請條件與實際可議價範圍無官方一手來源。

---

## 2. PayUNi 信用卡 Token／約定扣款／幕後授權：官方文件要求與 Sandbox／正式差異

### Takeaway
官方流程是「先用 UPP 或 UNi Embed 完成首次交易並取得持卡人同意綁卡（需帶 CreditToken＋UseTokenType）→ 交易成功回傳 CreditHash → 之後用 CreditHash 呼叫 /api/credit 幕後授權」。使用前必須向 PayUNi 提交「07 信用卡 Token API 申請書」與「05 幕後功能 API 申請書」（紙本簽章、掃描寄 service@payuni.com.tw），審核開通並綁定幕後授權 IP。CelebrateDeal 目前跑在 Vercel，需要固定出口 IP 才能綁定。

### Cited Findings
- 官方機制描述：商店與持卡人約定、持卡人同意交易完成後，商店可透過 PAYUNi 綁定信用卡（卡號加密存放於 PAYUNi，商店無法取得完整卡號）；須先以 UPP 或 UNi Embed 完成首次交易並讓持卡人同意建立 Token，成功後取得 CreditHash；之後用該 CreditHash 呼叫幕後 API；「須向 PAYUNi 提出申請，審核開通且綁定幕後授權 IP 即可使用」。[A] — [信用卡幕後 Token 交易 V1.3](https://docs.payuni.com.tw/web/#/7/522)（頁面時間 2026-07-01）
- 申請文件：官方「文件下載」頁提供 `07.PAYUNi_信用卡Token API申請書.xlsx` 與 `05.PAYUNi_幕後功能API申請書.xlsx`；規定申請表填妥後掃描 mail 至 service@payuni.com.tw；商業用戶蓋大小章、個人用戶蓋章或簽名；須本人親自簽章。另有 `04 會員指定對第三人付款同意書`、`06 信用卡 3D 驗證異動申請書`、`13 交易頁面免跳轉元件申請書`（UNi Embed 用）、`09 額度調整申請書`、`11 會員提領機制申請書`。[A] — [文件下載](https://docs.payuni.com.tw/web/#/7/245)（頁面時間 2026-08-04）
- 首次綁卡參數（UPP 2.0）：`CreditToken`（付款人識別，長度 200，字元 A-Za-z0-9@.#$%_-+）；`UseTokenType`＝1 約定信用卡（付款頁消費者可自行取消約定）／2 記憶卡號功能／3 強制約定（消費者無法取消）；`CreditTokenType`＝1 會員（會員旗下所有商店共用 Token，預設）／2 商店（僅首次交易商店代號可用）；`CreditTokenExpired`（MMYY，未帶則以卡片到期日為準）；成功回傳 `CreditHash`（僅在有 CreditToken 且授權成功才壓碼）與 `CreditLife`（MMYY）。UPP 文件另有「首次信用卡 Token 交易（3D／非 3D）」流程圖。[A] — [UPP 2.0](https://docs.payuni.com.tw/web/#/7/34)（頁面時間 2026-08-07）
- 幕後 API：POST `https://api.payuni.com.tw/api/credit`（測試 `https://sandbox-api.payuni.com.tw/api/credit`）；Header 建議加 user-agent「payuni」；TLS ≥ 1.2；Version 固定 1.3；以 Hash Key／Hash IV 做 AES 加密（EncryptInfo）＋SHA256（HashInfo）；必要欄位含 MerID、MerTradeNo（長度 25、`[A-Za-z0-9_-]`、10 分鐘內不可重複）、TradeAmt、Timestamp、ProdDesc；選填 `CreditHash`、`API3D`（1＝幕後強制 3D）、`UserIP`（帶入會納入全平台風險控管）、`CardInst`、`NotifyURL`（僅限 80／443 port）、`BuyerHash`。[A] — [V1.3](https://docs.payuni.com.tw/web/#/7/522)
- 回應狀態：`SUCCESS`／`UNKNOWN`（60 秒未收到銀行回應先回 UNKNOWN，後續結果 Notify 到 NotifyURL，或建議 15 分鐘後發動交易查詢）／`UNAPPROVED`；成功回傳 `CreditHash`、`CreditLife`、`TradeNo`、`Card6No`、`Card4No`、`AuthCode` 等。[A] — [V1.3](https://docs.payuni.com.tw/web/#/7/522)
- Token 管理 API：查詢 `POST /api/credit_bind/query`（以 CreditToken 或 CreditHash 擇一查詢，回傳 Result 陣列，含 CreditTokenStatus 1 正常／3 刪除／4 逾期、CreditTokenExpired）；取消 `POST /api/credit_bind/cancel`（UseTokenType 1＝綁定用 CreditHash 取消、2＝記憶卡號用 CreditToken 取消）。[A] — [Token 查詢 Ver 1.0](https://docs.payuni.com.tw/web/#/7/40)（2026-07-13）、[Token 取消 Ver 1.0](https://docs.payuni.com.tw/web/#/7/41)（2025-03-13）
- 環境網址：測試區 `https://sandbox.payuni.com.tw`（API `https://sandbox-api.payuni.com.tw`）；正式區 `https://www.payuni.com.tw`（API `https://api.payuni.com.tw`）。測試卡：一次付清 `4147631000000001`／`3560511000000001`；模擬 3D ECI 不符取消授權 `...0002`；分期 `4147632000000001`（不支援 9 期）；銀聯 `6200000000000001`；到期日與末三碼可任意；Apple Pay／Google Pay／Samsung Pay 在測試區不限卡號一律模擬成功；ATM／超商代碼測試區以「模擬繳費」按鈕完成；LINE Pay 測試區 Channel ID／Secret 可填任意數字。[A] — [交易測試資料說明](https://docs.payuni.com.tw/web/#/7/374)（2026-03-17）、[UPP 2.0](https://docs.payuni.com.tw/web/#/7/34)
- 幕後 API 內含發票欄位：`CarrierType`（3J0002 手機條碼／CQ0001 自然人憑證／amego 會員載具／Donate／Company）與 `CarrierInfo`、`InvBuyerName`；`amego` 載具需要 UsrMail。電子發票開立結果另有 Notify（C0401 開立／C0501 作廢）。[A] — [V1.3](https://docs.payuni.com.tw/web/#/7/522)；[電子發票 Notify](https://docs.payuni.com.tw/web/#/7/344)（2025-10-07）
- Vercel 固定出口 IP：Static IPs（共用 VPC、僅出站 egress）僅 Pro／Enterprise 可用，定價 USD 100／月／專案，另加 Private Data Transfer（hnd1 USD 0.207／GB）；不適用 Routing Middleware（Edge）；預設情況下 Vercel 使用動態 IP。[A] — [Vercel Static IPs](https://vercel.com/docs/networking/static-ips)（頁面時間 2026-06-30）；[Vercel hnd1 Pricing](https://vercel.com/docs/pricing/regional-pricing/hnd1)（2026-09-14）
- 專案內部紀錄（非外部來源）：2026-09-29 內部文件記錄 Sandbox 商店已啟用信用卡一次付清、3D，「交易限制」頁的 IP 黑白名單與幕後授權 IP 核准不同；使用者轉述第三方文章稱 Sandbox 可自行啟用 Token，但未在 Sandbox 商店查核，且正式站 Token 啟用截圖不能套用到 Sandbox。[C，內部] — `docs/launch/payuni-token-contract-20260929.md`（repo 內部文件）

### Inferences
- 取得 CreditHash 的唯一路徑是「一次真實授權的首次交易」（官方文件未提到零元驗證），因此「綁卡」產品設計必須與一筆實際付款綁在一起（例如首期費用或首次購買）。（推論，官方文件描述的是首次交易，未明言禁止零元。）
- Vercel 動態 IP 與「綁定幕後授權 IP」衝突：需啟用 Static IPs（USD 100／月／專案 ≈ NT$3,100，以 USD/TWD 31 的假設估算）或把幕後授權呼叫放到有固定 IP 的代理服務；且 Static IPs 不涵蓋 Edge Middleware，幕後授權路由必須跑在 Node Functions。
- Sandbox 與正式差異：官方 docs 對「Sandbox 是否需申請」沒有分開描述，公開文件只說需申請審核開通並綁定 IP。實務上應假設正式環境需要紙本申請書與 IP 綁定，Sandbox 需向客服確認。
- CreditTokenType 選 2（商店）可避免不同商店共用 Token；若 CelebrateDeal 為每位商家開獨立 PayUNi 商店，Token 範圍與資金歸屬較容易切割，但開店審核成本也隨商家數增加。（推論）

### Gaps
- Sandbox 是否可自行啟用 Token／幕後權限、審核天數、IP 綁定可綁幾組，官方公開文件均未說明。
- 申請書 xlsx 內容（欄位、是否要求營業登記／網站審核、是否有開通費）未下載（依任務限制），因此申請書需要的附件未知。
- UNi Embed（免跳轉）申請條件僅知需 13 號申請書。
- 週期扣款（排程）重試策略、卡片到期自動更新（類似 Visa Account Updater）PayUNi 是否提供，文件中未見。

---

## 3. 與藍新 NewebPay、綠界 ECPay、TapPay、Stripe、LINE Pay 直連的比較（SaaS 代收／子商店）

### Takeaway
公開牌價相近：PayUNi 2.8%（稅別未標示）、藍新 2.8%【含稅】、綠界一般賣家 2.75%【未稅，另加 5%】、TapPay 2.75%＋年費。Stripe 官方支援國家清單不含台灣，不可作為台灣主體的主要收款。四家本地業者都沒有公開、可自助申請的「平台商／子商店」規格；綠界 API 有 PlatformID 欄位但取得方式不公開，藍新與 PayUNi 需洽業務。

### Cited Findings
- 綠界 ECPay 一般賣家（TWD【未稅】）：國內信用卡／信用卡分期／銀聯／Apple Pay 2.75%、每筆最低 5 元；ATM 虛擬帳號 1%、每筆最低 15 元；超商代碼 31 元；超商條碼 16 元；信用卡訂單處理費 1 元【含稅】；最終結算另加 5% 營業稅；撥款：付款後 10 日內；物流款每週二。特約賣家：系統設定費 5,000 元；金流服務費 13,000／1 年、22,100／2 年、27,300／3 年；國內信用卡 1.85%～2.75%、國外卡 3.5%～3.8%、信用卡分期 3%～12%；費率依風險評估議定。[A] — [綠界服務費率表](https://www.ecpay.com.tw/Business/payment_fees)（頁面標示 Copyright 1996-2026，無更新日期）
- 藍新 NewebPay（TWD【含稅】）：一次付清國內卡 2.8%（請款日 +10 日）；分期 3 期 3.0%／6 期 3.5%／12 期 7.0%／18 期 9.0%／24 期 12.0%／30 期 15.0%；Apple／Google／Samsung Pay、玉山 Wallet 2.8%；國外卡 3.5%；智慧 ATM 2.0 虛擬帳號 1.0%（單筆下限 10 元，付款日 +7 日）；ATM 轉帳 1.0%（單筆上限 20 元）；超商代碼 28 元（付款日 +10 日）；條碼 20 元；台灣 Pay 1.5%；提領手續費 10 元／筆（每月前 5 次免費）；交易額度：個人會員 20 萬、企業會員 60 萬；頁面註明費率、撥款天期與額度「依商店營運規模與資質彈性優惠調整」。[A] — [藍新費率一覽表](https://www.newebpay.com/website/Page/content/service_fare)（頁面 Copyright 2026，無更新日期；以標準瀏覽器 User-Agent 直接讀取 HTML）
- TapPay（TWD【未稅】，最終結算另加 5% 營業稅）：系統設定費 5,000 元；年費 11,000 元（此頁面讀取結果）；線上信用卡國內卡 2.75%、國際卡 3.5%（支援 Apple Pay、Google Pay、Samsung Pay）；分期僅玉山與中信，3 期 3%、6 期 3.5%；Shopify 上國內卡 3.1%；非 Shopify 平台每筆 Gateway 使用費 2 元；Card Update Service 每筆 0.5 元（自動更新過期卡）；LINE Pay 未列費率；撥款天期「依商店規模與風險彈性調整」；定期扣款／綁卡無單獨定價。[A] — [TapPay 費率](https://tappaysdk.com/taiwan-en/help/pricing)；與搜尋摘要所載年費 9,600 元矛盾（同頁不同快照），見 Gaps。
- Stripe：官方「Stripe 支援國家」清單的亞太地區包含澳洲、香港、日本、馬來西亞、紐西蘭、新加坡、泰國、印度（預覽）、印尼（預覽），不含台灣。[A] — [Stripe Global](https://stripe.com/global)（存取日 2026-10-18）；`stripe.com/en-tw/pricing` 回傳 404。第三方指南指出台灣開發者常以海外主體（Atlas）使用 Stripe。[C] — [shareuhack 指南](https://www.shareuhack.com/en/posts/taiwan-indie-dev-global-payments-guide-2026)（搜尋摘要，未全文驗證）
- 綠界 API 文件有 `PlatformID` 參數（供特約合作平台商專案使用），但文件沒有說明如何取得；綠界已與 Visa 合作導入代碼化服務與信用卡自動續期 AUE（Auto-Update Expiry）以提升綁卡交易授權成功率。[B] — [ECPay 全方位金流 API 文件](https://developers.ecpay.com.tw/)、[TechNews 2025-03-12](https://finance.technews.tw/2025/03/12/visa-token/)
- 藍新平台的商家資訊：藍新已完成數發部第三方支付服務業能量登錄；官方區分「代收模式（藍新撥款）」與「閘道模式（收單機構撥款）」。未見公開的平台商／子商店規格。[B] — [Yahoo 財經轉載](https://tw.stock.yahoo.com/news/%E8%97%8D%E6%96%B0%E7%A7%91%E6%8A%80-%E6%95%B8%E7%99%BC%E9%83%A8-%E7%AC%AC%E4%B8%89%E6%96%B9%E6%94%AF%E4%BB%98%E6%A9%9F%E6%A7%8B%E7%99%BB%E9%8C%84-%E4%B8%AD%E4%BF%A1%E8%B3%87%E8%9E%8D-fula%E4%BB%98%E5%95%A6-060754709.html)
- LINE Pay 直連線上特約：未找到公開的 2026 線上特店費率表。僅有 2025 年 Uber Eats 合作頁提到一般商店手續費原為 3%【未稅】，但屬店內情境，不能套用。LINE Pay Money 於 2025-12-03 上線。[C] — [Uber 合作頁](https://www.uber.com/zh-TW/blog/restaurant-partner-pv-linepay)；[B] — [工商時報／中時 wantrich 2025-12-03](https://wantrich.chinatimes.com/news/20251203900403-420101)
- 平台代收轉付的法規背景：數發部自 2023 年 7 月底實施「第三方支付服務業能量登錄制度」，要求提供法遵聲明書、足額履保或信託專戶等；業者年度代理收付日均餘額逾 20 億元須向金管會申請電支許可（2025 年初報導）。[B] — [TechNews 2023-08-13](https://technews.tw/2023/08/13/ministry-of-digital-affairs-third-party-payment-money-laundering/)、[Newtalk 2025-01-02](https://newtalk.tw/news/view/2025-01-02/951481)
- PayUNi 官網說明交易款項進入中國信託信託專戶，並提供「代理商專區」入口與「04 會員指定對第三人付款同意書」申請書（用途細節未公開）。[A] — PayUNi 官網前端（https://www.payuni.com.tw/js/app.js）；[文件下載](https://docs.payuni.com.tw/web/#/7/245)

### Inferences
- 每 NT$1,000 國內信用卡訂單的粗估費用（單筆，不含固定費）：PayUNi 約 28（若加 5% 則 29.4）；藍新 28【含稅】；綠界 27.5×1.05＋1 處理費 ≈ 29.9；TapPay (27.5＋2)×1.05 ≈ 31.0（假設 Gateway 費同為未稅）。差距主要來自協商費率與固定費，而非牌價。
- 若 CelebrateDeal 以「單一平台商店收款再分潤給商家」的方式運作，等同代收轉付，可能觸及第三方支付／電子支付的登錄或許可問題；較穩健的模式是「商家自有金流商店（各自 MerID）＋平台以 API 呼叫」或「商家自有 PayUNi 會員、平台只做串接」。此為法務待確認事項，並非法律意見。
- 以 PayUNi 為主、保留藍新或綠界為備援的策略在費率上沒有明顯劣勢；綠界的優勢是內建電子發票與較完整的公開費率表，藍新的優勢是費率表含稅且透明。

### Gaps
- 四家本地金流商都找不到公開的「平台商／子商店（sub-merchant）」申請條件、分潤／分帳、退款責任分界。
- 藍新與綠界的定期定額／綁卡（Token）手續費、PayUNi Token 是否額外計費，均無公開數字。
- TapPay 年費 11,000（頁面讀取）與 9,600（搜尋摘要）互相矛盾，無法確認哪個為現行；LINE Pay 直連費率與申請流程無官方公開來源。
- 各家 2026 年是否調價無公告可查（頁面皆無更新日期）。

---

## 4. LINE 官方帳號 2026 價格、Messaging API 限制、LINE Login 要求與簡訊替代方案

### Takeaway
LINE 官方帳號將於 **2026-11-01（與內測同日）** 調價：中用量由 800 調為 1,000、高用量由 1,200 調為 1,400（皆【未稅】）；高用量加購改為階梯式（前 50,000 則每則 0.2 元，第 50,001 則起 0.15 元）。中用量不可加購。Messaging API 只計 push／multicast／broadcast／narrowcast，且依收訊人數計費。簡訊約 NT$0.7～1.2／則（舊資料）到 Twilio 約 USD 0.0842／則，成本都遠高於 LINE 高用量加購。

### Cited Findings
- 價格表【未稅】：輕用量 0 元（200 則免費，不可加購）；中用量 800→**1,000** 元（3,000 則免費，不可加購，超量須升級高用量）；高用量 1,200→**1,400** 元（6,000 則免費，可加購）；自 2026/11/1 起生效。[A] — [LINE Biz-Solutions《2026年 LINE 官方帳號方案價格調整》](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/)（存取日 2026-10-18）
- 高用量加購【未稅】：當月第 1～50,000 則每則 0.2 元；第 50,001 則起每則 0.15 元（階梯式累進）。[A] — 同上
- 同意與維護時程：2026/10/27 後仍使用中／高用量方案即視為同意新價格，不同意者須在該日前改為輕用量；官方建議在 10/27 前新增次要付款方式；系統維護期 10/28 至 11/2 及 11/24 至 11/25，部分方案與付款功能暫停。[A] — [LINE Biz-Solutions 調價公告](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/)；官方產品頁亦標示「2026/11/1 起調整」並說明費用皆不含稅：[LINE 官方帳號產品頁](https://tw.linebiz.com/service/account-solutions/line-official-account/)
- 計價規則：計入則數的是 push、multicast、broadcast、narrowcast；reply 訊息不計費；以「發送對象人數」計算（一次 push 帶 4 個訊息物件、發給 5 人，算 5 則）；發給已封鎖或不存在使用者 ID 的訊息不計；超過額度時 API 回錯誤且不發送。[A] — [Messaging API Pricing](https://developers.line.biz/en/docs/messaging-api/pricing/)
- 一對一聊天、自動回覆、歡迎訊息、Reply API、LINE VOOM 貼文不計費；費用不含素材製作與 API 開發。[A] — [LINE 官方帳號產品頁](https://tw.linebiz.com/service/account-solutions/line-official-account/)
- Rate limits（每個 endpoint、每個 channel，token bucket，超過回 429）：Send multicast message 200 requests/s；其他 endpoint（含 push、reply）2,000 requests/s；Send broadcast／narrowcast 60 requests/hour；Set webhook endpoint URL 1,000 requests/min；Create rich menu 等 100 requests/hour。[A] — [Messaging API reference – Rate limits](https://developers.line.biz/en/reference/messaging-api/index.html.md)（存取日 2026-10-18）
- LINE Login：取得使用者 Email 需在 LINE Developers Console 的 OpenID Connect 設定中申請，需同意條款並上傳說明「收集 Email 及用途」的畫面截圖，核准後顯示 Applied；channel 名稱不可含「LINE」等字樣；可為單一 channel 設定多個 callback URL；連結的 LINE 官方帳號必須與 Login channel 屬於同一個 provider。[A/B] — [LINE Login 整合文件](https://developers.line.biz/en/docs/line-login/integrate-line-login/index.html.md)、[Getting started](https://developers.line.biz/en/docs/line-login/getting-started/)（搜尋摘要，未逐字全文驗證）
- 簡訊（舊／間接資料）：單通簡訊約 NT$0.7～1.2；EVERY8D 約每點 0.85（買 500 點）降到 0.7 以下（5 萬點以上）；三竹主打 0.7 元起；廣告簡訊另有 1.5 元起（其他業者）。文章無日期、稅別【未標示】。[D] — [uptogo 簡訊一則多少錢](https://uptogo.com.tw/%e7%a7%91%e6%8a%80/%e6%89%8b%e6%a9%9f/%e7%b0%a1%e8%a8%8a%e4%b8%80%e5%89%87%e5%a4%9a%e5%b0%91%e9%8c%a2%ef%bc%9f/)
- Twilio 台灣出站簡訊：USD 0.0842／則（message segment），僅提供國際號碼（International Numbers）作為寄件者，「可能另有電信業者費用」；國際號碼月租起價 USD 1.15。[A] — [Twilio SMS Pricing – Taiwan](https://www.twilio.com/en-us/sms/pricing/tw)（存取日 2026-10-18）

### Inferences
- 中用量方案（3,000 則免費、不可加購）無法支撐「2,000 名報名者 × 每場 ≥ 2 則通知 × 4 場」的情境，商家要自行用 LINE 通知就必須升到高用量 NT$1,400／月起。
- 內測日 2026-11-01 與調價日、10/28～11/2 維護期重疊，內測期間若依賴 LINE 付費方案升降級或加購，可能遇到管理後台功能暫停。
- Messaging API 只能 push 給「已加入好友」的使用者 userId；報名者若未加好友無法被通知（此點為一般性已知規格，本次未取得本版文件引文，需在 Console 驗證）。
- 簡訊每則成本約為 LINE 高用量加購單價（0.2 元）的 3.5～6 倍（本地簡訊舊資料）至 13 倍以上（Twilio，以 USD/TWD 31 為假設）。

### Gaps
- 調價前高用量加購階梯完整價格（官方只說「0.2 元起降」）未取得，無法精確回算舊價。
- 三竹、EVERY8D 無 2026 官方價目頁；Twilio 台灣業者附加費未列。
- LINE 稅率官方頁僅說「未稅」，未給稅率（台灣營業稅 5% 為推算，來自本檔第 3 節各金流商聲明）。
- LINE Login 與 Messaging API 在台灣的 2025–2026 規則變動：未找到官方公告。
- LINE Notification Messages（電話號碼推播）在台灣是否提供：本次未查證。

---

## 5. Meta Conversions API、TikTok Events API 與 Google Ads Enhanced Conversions 現行要求

### Takeaway
Meta 與 TikTok 都以「相同 event_name＋event_id」去重，窗口 48 小時；Meta 要求伺服器事件在 7 天內送出、user_data 與 client_user_agent 必填且需雜湊。未找到任何針對台灣直播導購的 2026 政策變動；全球性變動為 Meta 簡化 CAPI 設定與歸因視窗調整、Google 合併 Enhanced Conversions 設定並把離線轉換改走 Data Manager API。

### Cited Findings
- Meta 去重：Pixel 的 `eventID` 必須與 CAPI 的 `event_id` 相同，且事件名稱一致；只在「收到第一個事件後 48 小時內」去重；內容無差異時通常優先保留先收到的事件；備援方法是 `event_name`＋`fbp` 和／或 `external_id`，通常只在「瀏覽器事件先到、伺服器事件後到」時有效；純瀏覽器或純伺服器不會去重。[A] — [Meta：Handling Duplicate Pixel and Conversions API Events](https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events.md)（頁面無日期）
- 第三方文章稱「伺服器與瀏覽器事件於約 5 分鐘內同時抵達時 Meta 偏好瀏覽器事件」，但 Meta 官方頁並未載明此規則。[C，與 A 不一致] — [Relevant Audience 指南](https://www.relevantaudience.com/facebook-ads/meta-pixel-and-conversions-api-guide/)
- Meta 最佳實務：所有事件需 `external_id` 與 `event_id`；網站事件需 `client_user_agent`、`event_source_url`；建議高品質比對參數：email、IP（`client_ip_address`）、姓名、電話；過於寬泛的參數組合（如 `fn`＋`ge`）會被拒絕；未使用 Business SDK 時需自行正規化並雜湊；Test Events 工具用於驗證接收與去重，測試事件需使用真實客戶資料否則可能被丟棄；EMQ 滿分 10，且目前僅適用網站事件。[A] — [Meta CAPI Best Practices](https://developers.facebook.com/docs/marketing-api/conversions-api/best-practices/)
- Meta `event_time`：必要欄位，Unix 秒、GMT；可早於送出時間最多 7 天，若請求中任何事件超過 7 天，整個請求回錯誤；離線事件應在轉換後 62 天內上傳（文件更新 2026-02）。[A/B] — [Meta Server Event 參數文件](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event)（搜尋摘要）
- Meta 2026 變動（全球，非台灣專屬）：2026-01-12 永久移除 Ads Insights API 的 7 日瀏覽與 28 日瀏覽歸因視窗（不影響 CAPI 收送）；2026-04-15 發布 AI 輔助 Pixel 升級與 CAPI 一鍵設定；廣告購買平台開發者政策（2026-02-03 起適用透明度義務）。[B/C] — [dataslayer 報導](https://www.dataslayer.ai/blog/meta-ads-attribution-window-removed-january-2026)、[PPC Land：一鍵 CAPI](https://ppc.land/metas-free-one-click-conversions-api-is-now-live-no-developer-needed/)、[PPC Land：廣告支出揭露](https://ppc.land/meta-forces-ad-spend-disclosure-to-advertisers-starting-february-2027/)
- TikTok 去重：需在 Pixel 與 Events API 兩邊帶相同事件名稱與 `event_id`；同通道（僅 Pixel 或僅 Events API）48 小時內去重；Pixel 與 Events API 之間於首事件之後超過 5 分鐘且 48 小時內合併／去重；保留先收到者；兩通道傳不同事件（例如 AddToCart 走 Pixel、Purchase 走 Events API）則無須去重。若無 event_id，可用 `_ttp` cookie 作備援匹配。頁面最後更新 **2025 年 5 月**（早於 2026）。[A] — [TikTok Ads Manager：Event deduplication](https://ads.tiktok.com/help/article/event-deduplication?lang=en)；備援 `_ttp` 說明來自[Taggrs](https://taggrs.io/docs/server-side-tracking/tiktok/event-deduplication)[C]
- TikTok `ttclid`（廣告點擊時由網址取得）與 `ttp`（first-party cookie）建議一併送出以提升匹配率；`test_event_code` 在 Events Manager → Test event 取得，僅用於伺服器端測試。[C] — [Zellify TikTok 整合文件](https://docs.zellify.app/platform-introduction/integrations/tiktok-pixel-and-events-api)（TikTok 官方 developer 文件頁無法抓取）
- Google Ads Enhanced Conversions：以 SHA-256 雜湊第一方資料（email 等）；可傳未雜湊資料由 Google 正規化雜湊，或自行正規化（去前後空白、小寫、電話轉 E.164、gmail.com／googlemail.com 去掉網域前的句點）後傳雜湊；國家、州、城市、郵遞區號不雜湊。[A] — [Google Ads 說明：Set up enhanced conversions for web](https://support.google.com/google-ads/answer/9888145)、[Google Ads API 文件](https://developers.google.cn/google-ads/api/docs/conversions/enhanced-conversions/web?hl=en)
- Google 2026 變動：2026-04 起 Google Ads 同時接受網站標籤、Data Manager、API 來源的 user-provided data；網站版與潛在客戶版 Enhanced Conversions 合併為單一開關；2026-06-15 起離線轉換匯入與潛在客戶版 Enhanced Conversions 上傳改走 Data Manager API，多數開發者在 Google Ads API 被封鎖。「63 天」上傳窗口僅出自第三方，未見官方。[B/C] — [PPC Land：合併為單一開關](https://ppc.land/google-ads-finally-collapses-enhanced-conversions-into-a-single-toggle/)、[Relevant Audience：2026 更新](https://www.relevantaudience.com/blog/google-ads-enhanced-conversions-2026-update/)

### Inferences
- CelebrateDeal 的「四事件 Meta outbox」若以訂單號或 registration id 作 `event_id`，同時於瀏覽器 Pixel 與 CAPI 使用同一個 ID，即可符合兩平台的去重規則；outbox 的重送須在事件首次被 Meta 收到 48 小時內才會去重，超過 48 小時重送可能重複計算，且超過 7 天會導致整批請求失敗。（推論自官方窗口數字）
- 直播導購的高價值事件（報名、進場、加購、付款）都在使用者登入或有 email／電話之後，非常適合同時傳 `external_id`、雜湊 email、電話與 `fbp`／`fbc`、`ttp`／`ttclid` 來維持 EMQ。

### Gaps
- 未找到任何台灣或「直播導購／live commerce」專屬的 2026 CAPI／Events API 政策變動。
- TikTok Events API 官方開發文件（business-api.tiktok.com）無法抓取，`test_event_code`、event match quality 評分、最新 payload 限制只有第三方來源。
- Meta 官方頁未標示更新日期；EMQ 目標分數官方未給。

---

## 6. 基礎設施單位成本（官方價目頁，2026）與 worked example

### Takeaway
影音遞送是單一商家成本的主體：Cloudflare Stream 遞送 USD 1／1,000 分鐘。一個商家每月 4 場、每場 60 分鐘、300 位同時在線者（若全程觀看）約 72,000 遞送分鐘 ≈ USD 72（約 NT$2,232）；LINE 通知（8,000 則）約 NT$1,800【未稅】；Vercel／Supabase／R2 的邊際成本在這個規模可忽略，但平台固定費（Vercel Pro、Supabase Pro、Sentry、Static IPs）約 USD 190 以上／月需要攤提。

### Cited Findings
- **Cloudflare Stream**：儲存 USD 5／月／每 1,000 分鐘容量（預付區塊）；遞送 USD 1／每 1,000 分鐘（後付）；進流（ingest）與編碼永遠免費；RTMP／SRT 直播錄影計入儲存分鐘，WebRTC 直播無法錄影；容量用完則無法上傳或開始新的直播（Enterprise 可超額）；頻寬含在遞送分鐘內無額外 egress；量大需洽業務。[A] — [Cloudflare Stream Pricing](https://developers.cloudflare.com/stream/pricing/)（存取日 2026-10-18）。該頁面讀取摘要另稱「WebRTC 遞送計費自 2026-10-15 起」，僅此一個來源，需於 Cloudflare 帳號確認。[B，待驗證]
- Stream Live：每個直播有獨立 live input 與 stream key，以 RTMPS 或 SRT 推流，自動轉成多解析度，可用 HLS／DASH 播放；所有直播自動錄影，結束後 60 秒內可重播；頁面更新 2026-04-21，未載明同時觀看人數與最長直播時間上限。[A] — [Cloudflare Stream Live](https://developers.cloudflare.com/stream/stream-live/)
- **Cloudflare R2**：Standard 儲存 USD 0.015／GB-月；Class A USD 4.50／百萬次；Class B USD 0.36／百萬次；Infrequent Access 儲存 USD 0.01／GB-月（Class A 9.00、Class B 0.90 每百萬次、取回 0.01／GB、最短保存 30 天）；出口（Internet egress）免費；免費額度：10 GB-月儲存、100 萬 Class A、1,000 萬 Class B。[A] — [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- **Vercel Pro**：USD 20／開發者席位／月，含 USD 20 用量額度、每月 1 TB Fast Data Transfer、1,000 萬 CDN Requests；超量：Fast Data Transfer 起價 USD 0.15／GB、CDN Requests USD 2／百萬、Active CPU 起價 USD 0.128／小時、Provisioned Memory 起價 USD 0.0106／GB-小時、Function Invocations 起價 USD 0.60／百萬。Enterprise 為客製報價。[A] — [Vercel Pricing](https://vercel.com/pricing)（USD、未含稅）
- **Vercel hnd1（東京）區域費率**（僅 Pro 方案適用，USD、未含稅，頁面更新 2026-09-14）：Fast Data Transfer 0.16／GB；CDN Requests 2.60／百萬；Fast Origin Transfer 0.27／GB；Fluid Active CPU 0.202／小時；Fluid Provisioned Memory 0.0167／GB-小時；ISR Writes 5.20／百萬；ISR Reads 0.52／百萬；Image Optimization 0.0661／千次轉換；Private Data Transfer 0.207／GB。[A] — [Vercel hnd1 Pricing](https://vercel.com/docs/pricing/regional-pricing/hnd1)；全區間範圍見 [Regional Pricing](https://vercel.com/docs/pricing/regional-pricing)（例如 Active CPU 0.128–0.221／小時）
- **Supabase Pro**：USD 25／月起，含 USD 10／月運算額度（涵蓋一個 Micro）；資料庫磁碟 8 GB／專案含、超量 USD 0.125／GB；egress 250 GB 含、超量 USD 0.09／GB；快取 egress 250 GB 含、超量 USD 0.03／GB；檔案儲存 100 GB 含、超量 USD 0.0213／GB；MAU 100,000 含、超量 USD 0.00325／MAU；運算（每月，按小時計）：Micro 10、Small 15、Medium 60、Large 110、XL 210、2XL 410、4XL 960；PITR 每 7 天保留 USD 100／月。[A] — [Supabase Pricing](https://supabase.com/pricing)（USD、頁面無日期；專案資料庫在東京區域，Supabase 價格頁摘要未提供區域差價）
- **Sentry**：Team USD 29／月（年繳 26）、Business USD 89／月（年繳 80）；皆含 50k errors、5M tracing spans、50 session replays、1 GB attachments、5 GB logs；Logs 與應用指標超量 USD 0.50／GB；Team 額外事件單價未於價目頁列出。[A] — [Sentry Pricing](https://sentry.io/pricing/)
- **電子發票（加值中心）**：綠界電子發票價格（未稅）：開辦費 3,600 元（新戶；續約 0）；年費依張數 5,000 張 3,600 元、20,000 張 6,000 元、120,000 張 12,000 元；新戶首年 20,000 張免費，優惠至 2026-12-31。[C] — [ACTGSYS 電子發票 API 串接要多久 2026](https://actgsys.com/zh/blog/e-invoice-api-integration-cost-timeline-2026)（2026-09-03，引述綠界費用頁，非一手）
- 與上列矛盾：理財周刊報導「綠界自今年初推出電子發票全面免費」。[B，與 C 矛盾] — [理財周刊](https://www.moneyweekly.com.tw/_Article?AID=225461)（2026 年，確切日期頁面未列）
- 電子發票法規：上傳期限 B2C 2 日、B2B 7 日；違規罰鍰 NT$1,500～15,000，自 2025-01-01 起；串接開發費用（廠商自家報價）單一系統 5～15 萬、多系統 20～50 萬、維護 5,000～15,000／月。[C] — [ACTGSYS](https://actgsys.com/zh/blog/e-invoice-api-integration-cost-timeline-2026)
- 光貿 Amego：PayUNi 內建的電子發票即採光貿；ezPay 電子發票採「購買額度」；兩者皆無公開 2026 價目可查。[A/D] — [PayUNi 說明](https://docs.payuni.com.tw/web/#/7/24)；ezPay 額度制出自第三方套件文件（packagist，D）

### Worked example（所有數字為估算，假設逐項標示）
**情境**：單一商家，每月 4 場直播，每場 60 分鐘，300 位同時在線，2,000 位報名者以 LINE 通知。

**假設（A = 假設，非事實）**
- A1 匯率 1 USD = NT$31（未查證，僅作示範，請以當期牌告匯率重算）。
- A2 「300 同時在線」視為整場 60 分鐘全程觀看（上限情境）；敏感度：平均觀看 45 分鐘、30 分鐘。
- A3 LINE 通知：情境 A 每位報名者每場 1 則（共 2,000×4＝8,000 則／月）；情境 B 每場 3 則（開賣前提醒、開播、重播）＝24,000 則／月。商家使用自己的 LINE 官方帳號，高用量方案，2026-11-01 後新價。
- A4 營業稅 5%（LINE 官方頁僅稱未稅；5% 為台灣營業稅標準稅率，出自金流商頁面聲明）。
- A5 Vercel：直播間每位觀眾每 10 秒一次輕量 API（聊天／狀態），每次 50 ms Active CPU，Provisioned Memory 以 Active 時間的 2 倍、1 GB 估。

| 項目 | 計算 | 結果 |
|---|---|---|
| Stream 遞送 | 300 人 × 60 分 × 4 場 ＝ 72,000 分 ÷ 1,000 × USD 1 | USD 72 ≈ NT$2,232／月 |
| 每場 | 18,000 分 | USD 18 ≈ NT$558 |
| 每 1,000 位觀眾（全程 60 分） | 60,000 分 | USD 60 ≈ NT$1,860 |
| 每 1,000 位觀眾（平均 45 分） | 45,000 分 | USD 45 ≈ NT$1,395 |
| 每 1,000 位觀眾（平均 30 分） | 30,000 分 | USD 30 ≈ NT$930 |
| Stream 儲存（錄影） | 240 分／月；第 1 個月至少 1 個 1,000 分鐘區塊 | USD 5／月起；12 個月累積約 2,880 分＝3 個區塊 ≈ USD 15／月（若不刪除） |
| LINE 情境 A（8,000 則） | 高用量 1,400 ＋ (8,000−6,000)×0.2 ＝ 1,400＋400 | NT$1,800【未稅】≈ NT$1,890【含 5%】；平均 NT$225／千則；邊際 NT$200／千則 |
| LINE 情境 B（24,000 則） | 1,400 ＋ 18,000×0.2 ＝ 1,400＋3,600 | NT$5,000【未稅】≈ NT$5,250【含 5%】；平均 NT$208／千則 |
| 同量簡訊對照（8,000 則） | 本地簡訊 NT$0.7～1.2 | NT$5,600～9,600；Twilio USD 0.0842×8,000＝USD 673.6 ≈ NT$20,882 |
| Vercel（hnd1）變動 | 請求 300×360×4＝432,000；Active CPU 432,000×0.05 秒＝6.0 小時×USD 0.202＝USD 1.21；記憶體約 12 GB-hr×0.0167＝USD 0.20；CDN Requests 0.432 百萬×2.60＝USD 1.12；Invocations 0.432 百萬×0.60＝USD 0.26 | 約 USD 2.8（≈ NT$87）／月；一般報名頁、結帳、通知 webhook 等另計，保守以 USD 3～10 估 |
| R2 | 假設該商家素材 5 GB，Standard | 5×0.015＝USD 0.075（落在平台共用 10 GB 免費額度內） |
| Supabase | 該商家資料量遠小於 8 GB 含量；egress 遠小於 250 GB | 邊際約 0，固定費見下表 |
| 金流（每筆 NT$1,000 國內卡） | 見第 3 節 | 約 NT$28～31／筆 |

**平台固定費（需攤提到所有商家；A6 假設 2 個 Vercel 席位）**

| 項目 | USD／月 | 約合 NT$（A1） |
|---|---|---|
| Vercel Pro（2 席位） | 40（含 USD 40 用量額度） | 1,240 |
| Supabase Pro（含 Micro） | 25 | 775 |
| Sentry Team（月繳） | 29 | 899 |
| Vercel Static IPs（PayUNi 幕後 IP 綁定，每專案） | 100（＋Private Data Transfer 0.207／GB） | 3,100 |
| 合計（未含 Stream 儲存、LINE、金流） | 194 | 約 6,014 |

### Inferences
- 單一商家在該規模下，影音遞送（約 NT$2,232）> LINE 通知（NT$1,800～5,000）>>> 運算與儲存（< NT$200）；毛利模型的重點是「每千名觀眾分鐘數」與「每則通知單價」，而非 Vercel／Supabase。
- 若商家以自己的 LINE 官方帳號付費，平台的 LINE 通知成本趨近 0，只剩 API 呼叫；若平台統一使用一個 OA 替所有商家發送，平台需自行吸收或轉嫁方案費，且 11/1 後單一 OA 的中用量不可加購。
- Static IPs 的 USD 100／月是為了 PayUNi 幕後授權而額外增加的固定成本，應在是否上線「綁卡扣款」功能的決策中一併計入。
- 若 Stream 遞送實際以較低的平均觀看分鐘計（30～45 分），每場成本約下降 25%～50%。

### Gaps
- 匯率、實際平均觀看時間、通知則數、Vercel 請求量、席位數都是假設，須以內測數據替代。
- Stream 同時觀看人數／直播時長上限、延遲規格，官方頁未載明。
- Supabase 對東京區域是否有區域差價，價目頁摘要未提供；Sentry Team 超量事件單價未於價目頁列出。
- Vercel 價目頁的 Pro「含用量」細節（Active CPU／記憶體／Invocations 是否含免費量）與 hnd1 專頁的呈現不完全一致，Function Invocations 在 hnd1 專頁無獨立區域價；上表採用價目頁的 USD 0.60／百萬。
- 電子發票：ECPay 是否全面免費（理財周刊）與年費表（ACTGSYS）互相矛盾；光貿 Amego、ezPay 無價目；未找到「每張發票」計價。

---

## 7. 整合前置作業清單（團隊需申請／確認）

### Takeaway
最長天數與最不確定的項目：PayUNi Token＋幕後 API 紙本申請與 IP 綁定、Vercel Static IPs、LINE 官方帳號 11/1 調價與 Email 權限申請、金流平台代收轉付的法務判斷。

### Cited Findings
- PayUNi：註冊會員並建立收款商店取得 MerID；支付方式逐項審核（審商店資料、商品、網址）；Token 需 07 號申請書；幕後授權需 05 號申請書並綁定 IP；UNi Embed 需 13 號申請書；額度調整 09 號；LINE Pay 需自行到 LINE Pay 申請 Channel ID／Secret；電子發票於 PayUNi 後台設定光貿。[A] — [V1.3](https://docs.payuni.com.tw/web/#/7/522)、[文件下載](https://docs.payuni.com.tw/web/#/7/245)、[UPP 2.0](https://docs.payuni.com.tw/web/#/7/34)、[PayUNi 說明](https://docs.payuni.com.tw/web/#/7/24)
- PayUNi 回呼：NotifyURL 僅限 80／443 port；信用卡 UNKNOWN 需 15 分鐘後查詢；MerTradeNo 10 分鐘內不可重複。[A] — [V1.3](https://docs.payuni.com.tw/web/#/7/522)
- Vercel：Pro 計畫與 Static IPs（USD 100／月／專案）。[A] — [Vercel Static IPs](https://vercel.com/docs/networking/static-ips)
- LINE：Messaging API channel、LINE Login channel 需在同一個 provider 下才能連結官方帳號；Email 權限需在 Console 申請並附截圖；10/27 前決定是否接受新價格；10/28～11/2 維護期。[A] — [LINE Login 文件](https://developers.line.biz/en/docs/line-login/integrate-line-login/index.html.md)、[LINE 調價公告](https://tw.linebiz.com/column/LINEOA-2026-Price-Plan/)
- Meta／TikTok：需 Pixel／Dataset、存取權杖、Test Events 驗證；TikTok 需 Pixel 與 Events API 皆帶 event_id。[A] — [Meta Best Practices](https://developers.facebook.com/docs/marketing-api/conversions-api/best-practices/)、[TikTok 去重](https://ads.tiktok.com/help/article/event-deduplication?lang=en)
- 電子發票：上傳期限 B2C 2 日、B2B 7 日。[C] — [ACTGSYS](https://actgsys.com/zh/blog/e-invoice-api-integration-cost-timeline-2026)

### Inferences
- 建議在內測（2026-11-01）前完成並取得書面回覆的項目：PayUNi 幕後 API 與 Token 申請書（含 Sandbox 開通方式）、信用卡 30 天累計額度調整、代收轉付的法務意見、Vercel Static IPs 決策、LINE OA 方案選擇、LINE Login Email 權限。
- 電子發票供應商選擇會牽動金流商：PayUNi 內建光貿，綠界內建自家發票，二者混用需要自行開立。（推論）

### Gaps
- 各申請書的實際審核天數與附件要求；PayUNi 幕後授權可綁定的 IP 數量。
- Meta Business Verification／TikTok 商務帳號在台灣的額外要求本次未查證。

---

## 來源可信度與衝突摘要
1. PayUNi 費率來自官網前端資料，無更新日期、稅別未標示；與第三方「原 2.8%、優惠 2.4%」一致，但優惠條件無官方文件。
2. TapPay 年費 11,000（頁面讀取）對 9,600（搜尋摘要）互相矛盾，採用頁面讀取並標示矛盾。
3. 綠界電子發票「全面免費」（理財周刊 2026）對「年費 3,600 起、新戶首年 20,000 張免費至 2026-12-31」（ACTGSYS 引述綠界）矛盾，需向綠界確認。
4. Meta「5 分鐘瀏覽器優先」只見於第三方，官方去重頁未載明。
5. TikTok 去重官方頁更新於 2025-05（早於 2026），其餘細節只有第三方。
6. LINE 2026-11-01 價格與規則取自 LINE 官方「Biz-Solutions」公告，另有 3 個二手來源一致；較舊的第三方（FIRST LINE 2023-09）仍列 800／1,200，已過時。
