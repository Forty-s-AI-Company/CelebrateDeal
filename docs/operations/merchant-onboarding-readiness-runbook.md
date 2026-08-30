# 商家 Onboarding Readiness 與 Owner Handoff Runbook（本機草案）

狀態：`DRAFT_LOCAL_ONLY`
範圍：將既有本機功能、Sandbox 與 staging 證據整理成可交接的商家 onboarding 步驟。
非範圍：本文件不建立帳號、不寄邀請、不收集商家資料、不操作付款供應商、不變更 DNS 或 Production，也不構成法務、客服或 Release owner 的簽核。

## 0. 證據狀態與使用原則

每一個階段只能使用下列其中一種狀態；`LOCAL_EVIDENCE` 不可外推為實際商家或 Production 驗收。

| 狀態 | 意義 | 下一步 |
| --- | --- | --- |
| `LOCAL_EVIDENCE` | 已有本機 deterministic test、程式或文件證據 | 由指定 owner 判讀是否足夠進入外部驗收 |
| `EXTERNAL_REQUIRED` | 需要第三方服務、Sandbox 或 staging 的可稽核結果 | 不得以 mock 或截圖替代 receipt |
| `MANUAL_REQUIRED` | 需要真人依 UI、流程或可用性逐步確認 | 使用去識別 checklist 留下結果 |
| `OWNER_ACCEPTANCE_REQUIRED` | 需要有權責 owner 明確接受風險或完成交接 | 記錄 owner、日期、範圍與結論 |
| `BLOCKED` | 前置條件、權限或證據不足 | 停止該階段，列出缺口後升級 |

所有紀錄只可保存環境分類、短雜湊參照、狀態、日期與驗收結論。不得填入姓名、完整 email、密碼、Cookie、Token、付款資料或原始 provider payload。

## 1. 角色與不可轉讓邊界

| 角色 | 責任 | 不可取代的決定 |
| --- | --- | --- |
| 商家 owner | 商家資料、成員、商品與商業流程最終承擔 | 接受商家上線前置條件與至少一位 active owner |
| 商家 admin | 協助設定品牌、商品、直播與日常管理 | 不能取代 owner 接受權限／法務風險 |
| 商家 accountant | 檢視帳務投影與核對作業 | 不能操作 provider 或核准 Production 退款 |
| 支援人員 | 依 SOP 受理與升級事件 | 不能要求登入資料或重送退款 |
| 平台管理員 | 判讀平台設定、權限與 webhook／帳務投影 | 不能替商家或 Release owner 接受商業風險 |
| Release owner | 核准正式環境操作、風險接受與回滾 | 不能把 local/Sandbox 證據宣稱為 Production 完成 |

## 2. 八階段 onboarding 檢查與交接

| 階段 | owner | 前置條件 | 可接受證據 | 停止條件 | handoff |
| --- | --- | --- | --- | --- | --- |
| 1. 商家／owner 身分與唯一責任 | 商家 owner | 商家已指定負責人與替代聯絡流程 | `OWNER_ACCEPTANCE_REQUIRED` 的去識別 owner 確認；每個商家僅有一個主要責任歸屬 | 無法確認誰可接受風險，標示 `BLOCKED` | 商家 owner 把責任範圍交接給平台管理員與 Release owner |
| 2. 密碼、session、MFA、recovery 與最小權限 | 商家 owner、平台管理員 | owner 可使用受控帳號；安全設定頁與政策已可用 | `LOCAL_EVIDENCE`：密碼、session 撤銷、MFA、recovery 與角色保護的相關測試；`MANUAL_REQUIRED`：真人完成受控設定 | 沒有 MFA、recovery 保存確認，或權限較需求寬鬆 | 平台管理員回填安全狀態，不傳遞任何憑證 |
| 3. 成員邀請、角色與 active owner | 商家 owner | 階段 2 完成；角色需求已寫明 | `LOCAL_EVIDENCE`：owner/admin/accountant 邊界與最後一位 owner 保護；`MANUAL_REQUIRED`：至少一位 active owner 可登入 | 無 active owner、邀請不明或要求共用帳號 | 商家 owner 確認角色清單後交給平台管理員覆核 |
| 4. 品牌與 tracking | 商家 admin | 商家 owner 已指定品牌與追蹤責任 | `LOCAL_EVIDENCE`：設定入口與 dashboard checklist；`MANUAL_REQUIRED`：去識別畫面檢查 | 未定義追蹤目的／同意基礎，或設定無法辨識 | 商家 admin 交接設定摘要與未決決策給 owner |
| 5. 商品、直播、表單、互動角色與腳本 | 商家 admin | 階段 3 已確認角色；可用 synthetic 內容 | `LOCAL_EVIDENCE`：dashboard checklist 的商品、直播、互動角色、互動腳本項目；`MANUAL_REQUIRED`：synthetic journey 演練 | 缺少必要內容、角色無權限或流程無法演練 | 商家 admin 提供去識別的 readiness 摘要給商家 owner |
| 6. 方案與 PayUni 邊界 | 商家 accountant、平台管理員 | 訂價／退款責任人已指定；不得使用真實付款資料 | `LOCAL_EVIDENCE`：PayUni Sandbox receipt 與拒絕／對帳 evidence；`EXTERNAL_REQUIRED`：Sandbox 或 staging 的範圍內驗證 | 供應商與站內狀態不一致、需要正式 merchant 或真實金流 | 依付款退款 SOP 把已知／未知與禁止重試原因交接給 owner |
| 7. 支援與退款 SOP handoff | 支援人員、商家 accountant | 已閱讀付款、退款支援與事件升級 SOP | `LOCAL_EVIDENCE`：SOP 角色、P0/P1/P2、停止條件與去識別模板；`OWNER_ACCEPTANCE_REQUIRED`：支援／財務責任人接受流程 | 沒有事件升級 owner，或有人要求支援人員操作 provider | 支援人員交接事件入口、升級路徑與未驗收風險 |
| 8. DNS、條款、隱私、退款政策與正式 owner acceptance | Release owner、商家 owner | 前七階段有去識別 evidence，且 Production scope 已被明確提出 | `EXTERNAL_REQUIRED`：DNS／站點環境；`MANUAL_REQUIRED`：條款、隱私、退款政策；`OWNER_ACCEPTANCE_REQUIRED`：正式 release 決定 | 缺少法務／營運驗收、Production 權限或回滾計畫 | Release owner 保存正式範圍、rollback 與驗收證據；否則維持 `BLOCKED` |

## 3. 環境矩陣

| 環境 | 可以作為 evidence 的內容 | 明確禁止或不代表 |
| --- | --- | --- |
| local | 程式、deterministic tests、synthetic tabletop、文件連結 | 不代表實際商家、寄信、外部服務或正式環境 |
| sandbox | 官方 PayUni Sandbox 的 synthetic 付款／退款與 receipt | 不代表 Production merchant、真實付款或正式對帳 |
| staging | 受控路由、UI、非正式的整合驗證 | 不代表 DNS 切換、正式資料、正式監控或商業上線 |
| production | 僅在 Release owner 明確授權、具備 rollback 與驗收窗口時 | 不能以本 runbook 自動啟用或替代簽核 |

## 4. Synthetic tabletop checklist

下列演練只使用 synthetic vendor、synthetic user、synthetic product 與短雜湊參照；不得建立真實帳號、寄邀請或聯繫商家。

- [ ] 指定六個角色的演練責任範圍與一個安全的升級路徑。
- [ ] 用 dashboard checklist 確認商品、直播、互動角色、互動腳本與 tracking 是可辨識的 readiness 項目。
- [ ] 演練「缺少 active owner」時標示 `BLOCKED`，而非繼續設定。
- [ ] 演練「付款／退款狀態不一致」時依 SOP 升級，不重送 provider 請求。
- [ ] 演練「需要條款、隱私、退款政策或 DNS」時切為 `MANUAL_REQUIRED` 或 `EXTERNAL_REQUIRED`。
- [ ] 演練交接模板不含個資、憑證或付款資料。

## 5. 去識別 handoff template

```text
商家短雜湊參照：
環境：local / sandbox / staging / production
目前階段與狀態：
已驗證 evidence（路徑或 receipt ID）：
未知或 BLOCKED 項目：
下一位 owner：
唯一安全下一步：
需要的授權、外部帳號或人工簽核：
回滾／停止條件：
交接日期與接受結論：
```

## 6. 可引用來源與限制

- [Dashboard checklist](../../src/lib/dashboard-checklist.ts)：僅證明本機 checklist 定義；不證明實際商家內容已建立。
- [Security settings](<../../src/app/(app)/settings/security/page.tsx>)：僅說明密碼、session、MFA、成員與最小權限的產品邊界；不可複製或保存其安全資料。
- [PayUni Sandbox checkout runbook](../payuni-sandbox-checkout-runbook.md)：僅適用官方 Sandbox 與 synthetic 測試。
- [付款、退款支援與事件升級 SOP](payment-refund-support-incident-sop.md)：定義付款退款事件的停止與升級規則。
- [Manual launch blockers](../launch/manual-blockers.md)：法務、客服、商家 onboarding、DNS 與營運仍需要指定 owner 的外部／人工驗收。

本 runbook 未完成實際商家演練，未取得法律、客服或商家 owner 簽核，未執行正式付款，且不是 `PRODUCTION_READY` 或整體可販售宣告。
