# 晨間報告 2026-11-12

依 `phase-sparkling-harbor.md` 優先級矩陣自動推進一整晚的結果。排定的順序全部完成：#576、商品抽屜、互動腳本、U4、AI 評測集、常青場、U3、U5、U6，另外補做 P0 的 U1 和 S5。過程中發現的 CI 不穩定與產品 bug 也一併修掉了。

規則都照做：每個 PR 都跑 typecheck、lint、相關 vitest；UI 變更跑完整 e2e；高風險變更經 Opus reviewer 獨立審查並修完 findings；沒有降低測試門檻、沒有 skip、沒有 force push。

## 1. 已合併的 PR

| PR | 說明 |
|---|---|
| [#576](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/576) | 直播精靈用側邊抽屜就地上傳影片或貼影片網址，並修正抽屜關閉後焦點偶爾沒回到 select 的問題 |
| [#577](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/577) | AI M0：30 題繁中評測集（`docs/ai/eval/zh-tw-v1.json`）與驗證器，題目以實際程式為準，不呼叫外部 API |
| [#578](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/578) | 依程式現況更新 ROADMAP／DECISIONS 中常青場、課程、A/B、直播精靈的描述 |
| [#579](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/579) | 成交步驟用側邊抽屜就地新增商品；商品核心抽成 `product-save.ts`。已審查（金額、租戶） |
| [#580](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/580) | 補上常青場 `recurring_daily` 的瀏覽器端到端測試（含竄改 cookie） |
| [#581](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/581) | 互動腳本改在新分頁建立，回到精靈時自動刷新清單 |
| [#582](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/582) | 修正常青場觀眾在自己場次開始前就收到「場後」信；關閉常青後重新啟用被取消的課後信。審查兩輪 |
| [#583](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/583) | U4：抽出通用 Stepper、Tabs、Toast 與欄位錯誤 API，文件在 `docs/ui/components.md` |
| [#584](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/584) | U5：商品表單分段與段落導覽，課程分潤改用百分比輸入。已審查（佣金），並修好 hydrate 前送出舊值的漏洞 |
| [#585](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/585) | U3：漏斗編輯器內發布（以回滾交易做發布檢查）、自動儲存、結帳元件就地綁定商品。已審查 |
| [#586](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/586) | U6：側欄依專案流程預設收合、修正同名與重複圖示、新增 Ctrl+K 指令面板 |
| [#587](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/587) | U5：聯盟政策改用百分比，加分段、欄位錯誤與佣金試算（重用伺服器結算函式）。已審查，30 萬份隨機草稿與伺服器比對 0 筆不一致 |
| [#589](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/589) | S5：加入 CodeQL 靜態分析（PR、merge queue、每週） |
| [#590](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/590) | 學員討論區在 hydration 完成前停用表單。原本在慢網路下送出會把心得內容放進網址，這也是 CI 偶發失敗的根因 |
| [#591](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/591) | 修正 CI 才出現的直播精靈 axe 對比失敗：停用按鈕恢復可用時的 opacity 淡入。加了守門測試，CI annotation 也會帶出掃描點 |
| [#592](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/592) | 直播商品改依勾選順序決定置頂，並可「設為置頂」；編輯頁與觀看頁用同一排序。已審查 |
| [#593](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/593) | 指令面板的觸發按鈕要等快捷鍵掛上後才可用，修正 CI 偶發失敗 |

尚在 merge queue：[#588](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/588) U1 單一上線路徑。五份上線清單合為單一來源，修正 `project_funnel` 導向與 PayUni 文案，諮詢專案可以完成到 100%。已審查，CI 曾被上面的偶發失敗擋住，已合入修正後重跑。

## 2. 等 Fable 的項目

詳見 [docs/fable-queue.md](fable-queue.md)。目前 4 項，都屬於資料模型或跨模組設計，判斷錯誤的代價高，所以沒有硬做：

- **F-2**：常青場觀眾依自己的場次寄課後信（需要 migration，並設計觀眾與報名的綁定方式）
- **F-3**：Email 追銷序列（drip）
- **F-4**：自動化規則的多步驟與延遲（應和 F-3 共用排程設計）
- **F-5**：課程獨立章節 model 與 AI 課程大綱

F-1（CI 才出現的 axe 失敗）原本列在佇列裡，已由 Opus 在 #591 解決。

## 3. 需要你處理的事

### 帳號與設定（只有你能做）

1. **開啟 GitHub Dependency graph 與 Private vulnerability reporting**：Settings → Security → Code security。沒開的話，`Dependency review` 在動到相依或 workflow 的 PR 上會一直失敗（#589 就遇到了）。它不是必要檢查，不會擋合併，但等於沒有作用。
2. **手動觸發一次 `Security audit (weekly)`**，確認會開 issue。
3. **開通 Cloudflare AI Gateway 與 Workers AI token**：AI M1（情境式引導）以後都需要。評測集已經準備好。

### 產品決定

4. **常青場結束或改回草稿後的課後信**：目前會依原開播時間補寄給所有已驗證報名者，包含沒看過的人（#582 已如實寫進後台文案）。要不要改成只寄給看過的人？這和 F-2 相關。
5. **上線導引（#588）**：
   - 「完成測試訂單」「上傳 Logo」「邀請團隊成員」三個舊任務已不在統一清單，資料保留，要加回來嗎？
   - 公開的 `/merchant-onboarding` 是否維持獨立頁面？
6. **安全警示要不要送 LINE**（需要平台 OA），還是只用 GitHub issue 與信件。
7. **面向買家的 AI 生成內容要不要標示。**
8. **CodeQL 要不要設為必要檢查**：建議先看一兩週的 findings 雜訊程度再決定。

### 本機環境

9. 本機 `celebratedeal_test` 有一個失敗的 migration（`20261103090100_ledger_integrity_constraints`），也缺 `Vendor.suspendedAt`。代理在沒指定 DB 時會誤連到它而失敗，今晚一律改用 `celebratedeal_ci`。要修的話，建議重建這個可拋棄的資料庫。
10. 主 repo 長駐的 `next dev` 會鎖住共用 `node_modules` 的 Prisma 引擎檔，讓 e2e 的 `prisma generate` 出現 EPERM，代理只好用暫時設定跳過。不用時關掉 dev server 就好。

## 4. 後續可由 Opus／Sonnet 處理的項目（未做）

- 檢查其他 e2e 是否也有「hydration 前就按 Escape／Tab／方向鍵」的競態，優先看 `accessibility.spec.ts`、`announcement-center.spec.ts`、`commerce-orders.spec.ts`；另外 `course-player.tsx` 等學員元件可能有和 #590 相同的問題。
- 範本庫卡片（`TemplateCard`）有 52 處文字對比不足（U4 測試時發現），要確認 master 上是否原本就有。
- 「準備第一場可販售直播」的就緒判斷要求已發布的互動腳本，但步驟文案說腳本可選。
- 課後信 job 遇到 serialization failure 會中止整輪（既有問題）。
- 發布檢查目前會取得兩次發布鎖並寫入後回滾；若檢查頻率提高，可改成純讀的 preflight。
- U4 元件的後續遷移：Toast、Tabs、欄位錯誤，以及 28 個手寫輸入框。
- 評測集製作時發現的文件不一致，已在 #578 與 #588 處理大部分；其餘列在 #577 的 PR 描述。
