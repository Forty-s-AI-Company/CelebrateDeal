# 個人化上線導引與銷售專案

## 邊界決策

- `Vendor` 繼續作為商家 Workspace 與租戶邊界；品牌、團隊、訂閱、金流與 canonical 客戶身分不因切換專案而複製。
- `SalesProject` 是 Workspace 內的銷售流程容器。`SalesProjectProduct` 允許一個專案包含多個商品，也允許商品加入多個專案。
- `SalesProjectCustomer` 只保存 `customerKeyHash` 的專案關聯，不建立第二份姓名、Email 或電話；`CustomerCrmRecord` 仍是商家層級單一身分。
- 舊 `RegistrationForm`、`Live`、`ConsultationEvent`、`CommerceOrder` 與 `AnalyticsEvent` 只新增 nullable `projectId`。歷史資料保留在「全部專案總覽」，不做武斷回填。
- 工作模式只決定導覽、Dashboard、模板與任務排序；功能權限仍由訂閱與 `enabledFeatureModules` 判定。

## 任務狀態

持久狀態支援 `not_started`、`in_progress`、`completed`、`skipped`、`needs_attention`、`archived`。UI 偏好綁定 `User + Vendor`；商家與專案任務狀態綁定 Vendor scope。

完成狀態由商品、付款方式、表單、直播、預約、訂單與發布資料推導。持久列中的 `completed` 不能覆蓋缺失的真實資料；停止或收合導引也不會完成任務。必要項目略過時保留具體影響說明。

## 漸進 migration

`20260912103000_sales_workspace_onboarding` 是 additive migration：建立專案、關聯、偏好與任務表，並替既有資源加入 nullable project boundary。沒有刪表、改名、資料回填或 non-null 收緊。本輪未連線或套用到 Production。

## 註冊與恢復

新註冊 transaction 同時建立 User、Vendor、owner membership 與空白 onboarding preference，成功後才建立 session 並進入 `/welcome`。問卷每次選擇會保存完整且經 schema 驗證的快照；再次進入會從已保存題號續填。完成時同一 transaction 設定推薦模式、建立 Workspace 任務與第一個專案任務。

既有登入流程維持前往 Dashboard，不強迫既有帳號完成問卷；側欄仍提供任務中心。公開略過入口會將導引標為已結束，但不會將任何任務寫成完成。

## 回滾

功能回滾可先移除 UI、Server Actions 與 route，舊流程會回到 vendor-scoped Dashboard。資料層回滾應另做經審查的 forward migration，先解除 nullable project 外鍵，再移除新表與 enum；不可對已套用環境直接刪 migration 或使用 destructive reset。
