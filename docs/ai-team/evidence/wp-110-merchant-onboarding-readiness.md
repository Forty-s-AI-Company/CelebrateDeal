# WP-110 — Merchant Onboarding Readiness 與 Owner Handoff evidence

Date: 2026-07-31 (Asia/Taipei)  
Scope: CAT10 local documentation only.

## Deliverable

- 新增 `docs/operations/merchant-onboarding-readiness-runbook.md`；它是 `DRAFT_LOCAL_ONLY` 本機文件，未修改產品程式、既有 runbook、付款設定、DNS、外部服務或 `PRESERVE_ONLY` 檔案。
- 文件定義五種 evidence 狀態、六個角色、八個可停止與交接的 onboarding 階段，以及 local／sandbox／staging／production 環境邊界。
- 提供 synthetic tabletop checklist 與不含個資、憑證、付款資料的 handoff template；所有可引用來源都標明其證據範圍。

## Deterministic validation

- 文件必須包含完整八階段表格、每個階段的 owner、前置條件、可接受證據、停止條件與 handoff。
- 文件連結必須解析到既有本機檔案；不得有破損連結。
- 內容掃描不得出現可用憑證、完整卡號、真實 email 或 Production 已驗收等宣告。
- `git diff --cached --name-only` 必須維持空白，並保存 ownership／diff summary 的遮罩化 receipt。

## Explicit non-claims

本 WP 不建立或驗收實際商家、帳號、邀請、法務條款、客服流程、DNS、正式金流、Production 操作或 owner acceptance。它不會使任何外部項目自動解除，也不可把本機／Sandbox 證據當作可販售或 `PRODUCTION_READY` 證明。

## Score boundary

若 deterministic validation、AGY Fast 唯讀 QA 與 Sol High acceptance 均成功，本工作只支持 CAT10 **2.5 → 3.0**。實際商家 onboarding rehearsal、條款／隱私／退款政策、客服 owner、正式 release acceptance 與 Production 證據仍為 manual／external gaps。
