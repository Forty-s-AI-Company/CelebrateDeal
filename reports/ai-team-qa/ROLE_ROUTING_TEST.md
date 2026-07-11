# Role Routing Test Report

## 1. 測試目標
驗證 Orchestrator 是否會依「任務類型」(Task Type) 正確動態產生對應的審查與 QA 職位流程 (DAG)，而非只是單一職位派發，並確保不遺漏安全與審查環節。

## 2. 測試方式與發現
經分析 `automation/orchestrator.py` 以及 `automation/pipelines/` 目錄下的架構：

1. **單一派發邏輯**：`orchestrator.py` 中的 `route_task()` 函式只會根據 `task['type']` 在 `team-config.yaml` 找出對應的 **單一個別 Agent**（例如 `frontend-engineer`），並未具備依照任務類型自動推導完整 Hand-off Pipeline (如 Architect -> Engineer -> QA -> Reviewer) 的能力。
2. **寫死的 Pipeline**：系統依賴 `automation/pipelines/new-feature.yaml` 與 `repair.yaml` 作為固定的狀態機階段。這些固定階段並不會隨著「UI 任務」、「API 任務」或「RLS 任務」而有任何動態變更。
3. **缺少動態審核鏈**：當送入一個 UI 任務時，不會自動派發 `ui-ux-auditor` 或 `visual-regression-reviewer`；當送入分潤任務時，也不會自動確保觸發 `commission-qa-engineer`。

## 3. 預期與實際比對
| 任務情境 | 預期路由 (DAG) | 實際 Orchestrator 支援狀態 | 缺失說明 |
|----------|----------------|----------------------------|----------|
| UI 任務 | `product-architect` → `ux-design-lead` → `frontend-engineer` → `test-engineer` → `code-reviewer` → `ui-ux-auditor` → `visual-regression-reviewer` | **不支援** | 只依賴單一 `frontend-engineer` 處理，或走寫死的固化流程。 |
| API 任務 | `product-architect` → `system-architect` → `backend-engineer` → `test-engineer` → `code-reviewer` → `browser-qa-engineer` | **不支援** | 無法動態依據 API 類型加入特定的後端與 QA Reviewers。 |
| RLS/RBAC 任務 | `system-architect` → `database-security-engineer` → `test-engineer` → `security-reviewer` → `tenant-isolation-auditor` | **不支援** | 缺少動態加入 `tenant-isolation-auditor` 與 `security-reviewer` 的機制。 |
| 推薦歸因任務 | `product-architect` → `system-architect` → `attribution-engineer` → `test-engineer` → `security-reviewer` → `attribution-qa-engineer` | **不支援** | 無法觸發 `attribution-qa-engineer`。 |
| 分潤退款任務 | `product-architect` → `system-architect` → `commission-engineer` → `database-security-engineer` → `test-engineer` → `security-reviewer` → `commission-qa-engineer` | **不支援** | 無法觸發 `commission-qa-engineer`，這對金融交易功能是致命缺陷。 |

## 4. 確認事項
- [x] **任務是否有 reviewer**：否，單一任務派發時不會自動附加審查環節。固定 Pipeline 雖有 `code-reviewer`，但未綁定在零星的 Task Route 上。
- [x] **任務是否有 QA Role**：否，同上。
- [x] **是否會漏掉高風險審查**：是。例如 RLS 任務可能被當作一般的 Backend 修改，而漏掉 `security-reviewer`。
- [x] **是否有循環依賴**：目前的靜態 YAML 無循環依賴，但也無動態 DAG 處理能力。

## 5. 結論
**嚴重性：P1 (核心 Role Handoff 無法執行動態路由)**
目前的系統徒有眾多的 Roles 設定，但 Orchestrator 缺乏動態構建 Task DAG 的能力，這導致大部分的專項 QA Engineer (如 `ui-ux-auditor`, `tenant-isolation-auditor`) 實際上並未在自動化流程中被妥善調用。這必須藉由修改 `orchestrator.py` 的 routing engine 來修復。
