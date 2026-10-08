---
name: celebratedeal-browser-qa
description: CelebrateDeal 實際交付介面的合成資料 Playwright、登入／權限／購買與 responsive 驗證。
---

讀取 [瀏覽器 QA](../../../docs/ai-team/domain-workflows.md#瀏覽器-qa)，選擇符合風險的角色、狀態、viewport 與既有受控 runner，驗證 API／DB 落地並保存去識別 revision/head 證據。

執行沿用 [canonical vNext](../../../docs/ai-team/ROUTING.md) 和 [workflow policy](../../../docs/ai-team/workflow-policy.md)；不啟動舊排程、不保存含 secret 的 trace，也不以 retry 隱藏失敗。
