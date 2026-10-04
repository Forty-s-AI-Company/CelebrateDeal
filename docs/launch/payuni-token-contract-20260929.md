# PayUni Token 官方契約與 Sandbox 核准狀態

2026-09-29（Asia/Taipei）。瀏覽器官方文件觀察；不是綁卡成功收據。

## 已確認

- Chrome 公開文件頁點選已恢復；本輪乾淨 worktree 從 master `14e23f8e483c021390f5df22ca519c8068ee9b6a` 建立。原工作目錄未知變更保留。
- 已登入 Sandbox 商店「賀成交AI x CelebrateDeal」啟用，信用卡一次付清啟用、自動請款、3D 啟用。交易限制頁選擇關閉信用卡及 IP 交易限制。
- [UPP 2.0](https://docs.payuni.com.tw/web/#/7/34) 說明首次約定 Token 需要申請功能及綁定 IP；`CreditToken` 綁定付款人識別，`UseTokenType=1` 允許消費者取消約定，`2` 是記憶卡號，不能混為約定授權。`CreditTokenType` 區分會員共用與單商店；實作應使用單商店範圍並確認官方值。
- [幕後 Token 交易 1.3](https://docs.payuni.com.tw/web/#/7/522) 要求先以 UPP 或 UNi Embed 完成首次交易及同意綁卡，取得 `CreditHash` 後才進行後續約定授權。開通與幕後授權 IP 需另行申請。交易限制頁的 IP 黑白名單不是這項核准。
- [官方申請頁](https://docs.payuni.com.tw/web/#/7/245) 提供「07.PAYUNi_信用卡Token API申請書.xlsx」及「05.PAYUNi_幕後功能API申請書.xlsx」。表單要求本人簽章並掃描寄至官方客服；本輪未填寫、簽署或寄送。
- 使用者於 2026-09-30 提供正式站「PureFit健康管理」的信用卡 Token API 啟用截圖，並轉述第三方文章稱 Sandbox 可自行啟用。截圖只支持該正式商店的畫面狀態；Sandbox「賀成交AI x CelebrateDeal」商店的 Token／約定扣款權限及是否須另行申請仍未查核。不能將正式商店的開關套用到不同環境或商店，也不在正式環境進行綁卡測試。

## 仍未驗證／BLOCKED

- Sandbox 商店是否可自行啟用 Token、是否已有約定扣款權限，需先在該商店後台核對；若無權限或設定不明，再向 PAYUNi 確認申請方式。幕後授權 IP 與適用範圍仍無可核對收據。
- 未在本次讀取的官方契約確認獨立 `Merchant Token` 憑證為必要項；不要將 `CreditToken`、`CreditHash`、商店 API 金鑰及買方 `BuyerToken` 混用。
- 未確認零元 setup；現有官方流程描述首次交易。不能將已 PASS 的一般付款追認為綁卡，或重跑該付款。
- 商店預設 Notify／Return 指向另一個 Vercel host，非固定 staging alias。本輪未更動；這不證明前次 runner 的逐筆 callback URL 錯誤，因為 UPP 可帶逐筆 URL。
- master PayUni adapter 仍缺 setup 三方法；此外 `paymentMethodSetupDisposition` 明確拒絕 `form_post`，action 只接受 redirect。不能只補 adapter 就宣稱正常綁卡 UI 完成。需要可追蹤 setup intent、授權範圍及 consent、簽章 callback 綁定、重播防護、真正 provider reference、可用前端交接流程及 Critical review。
- Funnel 正常發布及公開 desktop/mobile 仍 BLOCKED。Stream 仍需獨立資源與範圍證據。

## 待本人向官方確認的文字（草稿，未寄送）

> 我們正在驗證 CelebrateDeal 的 PAYUNi Sandbox 信用卡約定 Token 流程。請協助確認指定 Sandbox 商店是否已開通 CreditToken／CreditHash 約定功能，或需提交第 07 號申請書；幕後授權 IP 是否需另以第 05 號表單申請？目前應用執行於 Vercel Preview，若需固定出口 IP，請告知核准方式。另請確認 Sandbox 首次綁定是否必須有金額交易、有無零元驗證流程，以及 UPP 2.0 單商店 Token 設定及成功 callback 的必要欄位。請勿以一般付款成功代替 Token 開通確認。

## 安全與交接

本輪未送出付款、退款、綁卡請求、DB 發布變更或 Production 操作。商店串接頁曾直接在無障礙樹回傳金鑰欄位；本文件不保存值，後續不得重新讀取該頁全文、複製或使用該輸出。受保護工作階段／CI 的既有 secret 注入仍是唯一執行來源。

requested/effective team：ai-team-pro；主代理單一 writer，observed model/effort unknown。Stream runner 的 canonical route 為 Sol high，必要 Critical review 因外部 AGY 既有無效審查而採 Astra high fallback；routing 不代表主對話模型改變。未取得 live 收據前保持未驗證，Goal 未完成。
