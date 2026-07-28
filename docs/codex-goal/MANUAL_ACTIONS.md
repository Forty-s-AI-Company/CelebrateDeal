# CelebrateDeal Manual Actions

最後更新：2026-07-25 01:18（Asia/Taipei）

> 僅列出自動化無法安全完成或需要 owner/人類感知的項目。每項完成後需附日期、環境、方法、結果與簽核角色。

## MA-001 — Supabase residual default ACL

- 服務：Supabase Production
- 目前狀態：待人工
- 原因：36 筆 platform-owner default ACL 需要 owner 權限或 Supabase Support 正式處理。
- 管理者最小操作：以 owner/Support 核准的方式清除 residual ACL。
- 非敏感回覆：`residual ACL=0/非0；52/52 RLS；existing API grants=0/非0；auto expose disabled；health/database；日期；方法；簽核角色`
- 完成條件：所有欄位齊全且 residual ACL=0。

## MA-002 — PayUni Production

- 服務：PayUni
- 目前狀態：待人工
- 原因：Production merchant/callback/signature 必須由已登入管理者唯讀確認。
- 管理者最小操作：確認 merchant 核准、ReturnURL/NotifyURL 指向 Production、signature/HashInfo 已配置。
- 禁止：建立付款、退款、callback。
- 完成條件：日期、Production、四項結果、方法、營運簽核角色齊全。

## MA-003 — Sentry delivery

- 服務：Sentry
- 目前狀態：待人工
- 原因：既有 Test Notification 不得重送，只能核對收件端回執。
- 管理者最小操作：提供已送達/未送達、接收類型、日期、方法、簽核角色。
- 完成條件：非敏感欄位齊全且已送達。

## MA-004 — Cloudflare exact binding

- 服務：Cloudflare Stream
- 目前狀態：待人工
- 原因：需證明 Production secret 綁定之 token active、Stream read/edit、account coverage 一致。
- 管理者最小操作：以官方 verify/status 或 Dashboard 提供一致/不一致摘要。
- 完成條件：日期、Production、active、read/edit、coverage、方法、簽核角色齊全。

## MA-005 — PostHog Production

- 服務：PostHog
- 目前狀態：待人工/受控一次事件
- 原因：需要確認 Production project 與一次無客戶資料事件到達。
- 管理者最小操作：完成必要登入；事件如已執行不得重送。
- 完成條件：日期、Production、到達結果、方法、簽核角色齊全。

## MA-006 — Screen reader

- 服務：Accessibility
- 目前狀態：待人工
- 原因：真實螢幕閱讀器操作與語意理解無法只靠 axe 取代。
- 管理者最小操作：依 QA_REPORT 的核心 journey 執行 NVDA/VoiceOver 驗收。
- 完成條件：登入、MFA、建立直播、公開頁、checkout/admin 的結果與 finding 齊全。
