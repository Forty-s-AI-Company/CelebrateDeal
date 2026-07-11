# Component Inventory

| Component | 現況 | 決策 |
| --- | --- | --- |
| `PageHeader` | 可用 | 保留；每頁一個主動作 |
| `Card` | 可用但容易濫用 | 只用於離散物件/工具，不包整個 page section |
| `ButtonLink` / submit / danger | 基本可用 | 補 focus-visible、disabled/loading 與深色 conversion token |
| `Field` / `TextArea` / `SelectField` | 基本可用 | 補 hint、error、required、description IDs |
| `Badge` | 可用 | 建立 semantic tone，不只 blue/orange/gray/green |
| `EmptyState` | 可用 | 描述下一步，不做裝飾 icon 堆疊 |
| App shell/sidebar | 桌面可用 | 補 `aria-current`、skip link；手機改群組 menu，不用無止境 chips |
| Data table | 多頁各自實作 | 收斂 search/filter/pagination/bulk/empty/loading/error |
| Interaction script editor | 桌面方向正確 | 修正手機四欄壓縮、角色選擇 semantics、30+ rows 效能 |
| Interaction roles workbench | 功能完整 | 收斂大圓角/漸層，保留左右清單與 avatar selector |
| Live stepper | 八步已具備 | 增加步驟阻塞條件、草稿保存與可驗證 preview |
| Live playback | 商品/CTA/官方聊天已具備 | 桌面不只手機 mock frame；補 aria-live、auto-scroll 與 network fallback |
| Toast/alert/dialog | 缺少共用 contract | 建立後再擴散，支援 focus management |
| Skeleton/loading | 缺少 | 只在真實等待狀態使用，避免假 loading |

