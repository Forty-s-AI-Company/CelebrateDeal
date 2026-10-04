# 全部分支參照處置（2026-10-04）

此文件保留發布前的處置 snapshot，基準為 `bdbae2f53491afd518b97ee597e117d6a585b55c`；截至該 snapshot 尚未合併 PR。權限恢復後的 #351 合併與其他交付進度見 [未來處理報告](branch-integration-future-work.md)。local／origin 同名可能指向不同提交，因此逐筆保留；數量不能當作獨立功能數。

已合併證據驗證 PR merge commit 可達 master，且本地／遠端分支 head 等於或早於該 PR head。patch 等價只證明歷史內容，不保證功能未被後續版本移除。

| 處置 | 參照數 |
| --- | ---: |
| 保留，待內容審核 | 66 |
| 已合併 PR，commit 在 master | 421 |
| 提交歷史已包含 | 17 |
| 有證據的新版本已替代 | 1 |
| 變更檔案與 master 相同 | 6 |
| 每個提交均有等價 patch | 4 |
| 已核對主線替代內容 | 3 |

## 逐筆清單

| 參照 | Head | 處置 | 證據／下一步 |
| --- | --- | --- | --- |
| `local/ai-team/isolated-write-smoke-20260712-0405` | `d8c85fbbb39e` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/chore/ai-team-v5.1-migration` | `937f796d25d0` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/ab-testing-contract-20260920` | `272b7346ce7c` | 已合併 PR，commit 在 master | [#229](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/229)；`57a0758a91f8` |
| `local/codex/accessibility-login-isolation-20260920` | `9f899e446ee4` | 已合併 PR，commit 在 master | [#242](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/242)；`2069f827a8a7` |
| `local/codex/ai-team-skills-automation-foundation` | `bf45235f8b10` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/announcement-truth-20260926` | `a6eaba1edfd1` | 已合併 PR，commit 在 master | [#319](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/319)；`236ad73cf1fb` |
| `local/codex/apply-stage-diagnostics-20260925` | `c55069b1cd7c` | 已合併 PR，commit 在 master | [#308](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/308)；`e7d529ef7171` |
| `local/codex/auto-auto-add-vendor-member-email-invitation-0ce8f8e8` | `79494a34dcbb` | 已合併 PR，commit 在 master | [#86](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/86)；`c9f09954239a` |
| `local/codex/auto-auto-confirm-vendor-member-deactivation-3f8fb123` | `3ace54c10b58` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-auto-detach-live-from-interaction-script-e8ccc0ff` | `638707f9f043` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-auto-fix-live-analytics-kpi-window-ef3a2883` | `36b38ad22f33` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-auto-handle-password-reset-email-failure-f444b1d2` | `62fb1655dc47` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-auto-harden-login-rate-limits-367f02af` | `fd315e6c03b5` | 已合併 PR，commit 在 master | [#90](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/90)；`803776ab77a6` |
| `local/codex/auto-auto-live-analytics-empty-states-cd25b32d` | `30230f4ab63c` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-auto-test-live-stepper-preview-8d4b75c7` | `7f1b3fd26e48` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-auto-test-vendor-member-deactivation-399b7b28` | `2cceebba802d` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-live-stepper-grounded-preview-63bea109` | `f5512bf0f0a2` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/auto-team-funnel-browser-e2e-visual-qa-573eca99` | `83ead8f08614` | 已合併 PR，commit 在 master | [#54](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/54)；`eba39d80b67b` |
| `local/codex/branch-integration-20261004` | `bdbae2f53491` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/checkout-pending-replay-20260924` | `9193326824b8` | 已合併 PR，commit 在 master | [#277](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/277)；`16c1bc259452` |
| `local/codex/consultation-actions-contract-20260920` | `71a4d4ad1099` | 已合併 PR，commit 在 master | [#238](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/238)；`0390c5ceef02` |
| `local/codex/consultation-actions-integration` | `638b7becb8c1` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/consultation-automation-contract-20260920` | `3adb8d745432` | 已合併 PR，commit 在 master | [#236](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/236)；`3fefe1c1ada0` |
| `local/codex/consultation-automation-schema-20260920` | `a22fb6a1c061` | 已合併 PR，commit 在 master | [#235](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/235)；`541506fb698c` |
| `local/codex/consultation-core-contract-20260920` | `6e9fc31a5819` | 已合併 PR，commit 在 master | [#233](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/233)；`638b7becb8c1` |
| `local/codex/consultation-deps-integration` | `429bc93d5b54` | 有證據的新版本已替代 | [#236](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/236)；[原 PR 作者確認](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/234#issuecomment-5748004765)；四檔差異已審核 |
| `local/codex/consultation-slot-engine-20260920` | `c166007e5203` | 變更檔案與 master 相同 | branch 變更面與 master blob 差異為 0 |
| `local/codex/consultation-ui-adapter-20260920` | `c7c74b8e0296` | 已合併 PR，commit 在 master | [#239](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/239)；`137a4a315be0` |
| `local/codex/core-ready-20260926b` | `d48b9d6da0c8` | 已合併 PR，commit 在 master | [#324](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/324)；`818b535e460a` |
| `local/codex/core-ready-status-20260926` | `3185d23fd9f4` | 已合併 PR，commit 在 master | [#339](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/339)；`099e6e2afa2d` |
| `local/codex/core-staging-acceptance-20260925` | `d8bb7ff57d5a` | 已合併 PR，commit 在 master | [#279](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/279)；`367382d35e6a` |
| `local/codex/core-staging-integration-20260925` | `5b742338d403` | 已合併 PR，commit 在 master | [#304](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/304)；`1d8bac1cc5ed` |
| `local/codex/core-staging-remaining-20260929` | `26a4c8880761` | 已合併 PR，commit 在 master | [#349](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/349)；`43809aaf286d` |
| `local/codex/current-exact-staging-backup-gate-20260925` | `9193326824b8` | 每個提交均有等價 patch | git cherry 全部為等價提交 |
| `local/codex/current-provider-probe-20260925` | `e59d4239fdcc` | 已合併 PR，commit 在 master | [#305](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/305)；`c8d4a1343647` |
| `local/codex/current-source-evidence-20260903` | `1806f4b8d050` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/current-staging-status-20260925` | `2b934cb243a2` | 已合併 PR，commit 在 master | [#314](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/314)；`2efdd7280d76` |
| `local/codex/dashboard-details-client-20260927` | `bcc4d161013c` | 已合併 PR，commit 在 master | [#340](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/340)；`18dc11e8cd23` |
| `local/codex/dashboard-details-latency-20260926` | `5fa001fe2365` | 已合併 PR，commit 在 master | [#328](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/328)；`5620f03f86b9` |
| `local/codex/dashboard-kpi-bounded-reads-20260927` | `c0b681a600dc` | 已合併 PR，commit 在 master | [#336](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/336)；`90b23968e350` |
| `local/codex/dashboard-stream-diagnostic-20260926` | `ef3dd7da9de8` | 已合併 PR，commit 在 master | [#327](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/327)；`82e178bc1785` |
| `local/codex/electronic-invoice-20260922` | `4c87dc4ee92e` | 已合併 PR，commit 在 master | [#260](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/260)；`c9844ac7798f` |
| `local/codex/evergreen-domain-20260919` | `7a19cc77300d` | 已合併 PR，commit 在 master | [#224](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/224)；`f47f5f7fceec` |
| `local/codex/evergreen-webinar-settings` | `4dd249d7c580` | 已合併 PR，commit 在 master | [#270](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/270)；`0c142b020107` |
| `local/codex/funnel-automation-settings-20260921` | `e0f45f15ebaf` | 已合併 PR，commit 在 master | [#255](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/255)；`bef2757ca833` |
| `local/codex/funnel-automation-vertical-slice-20260921` | `b941e1f1569c` | 已合併 PR，commit 在 master | [#252](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/252)；`fd2ba8f7a494` |
| `local/codex/funnel-automation-voucher-20260921` | `95c55f353204` | 已合併 PR，commit 在 master | [#256](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/256)；`9e426b4296d6` |
| `local/codex/funnel-browser-gate-20260919` | `f770e2b57663` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/funnel-browser-gate-20260922` | `117e22316146` | 已合併 PR，commit 在 master | [#272](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/272)；`1c47b31df89c` |
| `local/codex/funnel-browser-harness-20260920` | `0390c5ceef02` | 已合併 PR，commit 在 master | [#241](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/241)；`4cad289d4d64` |
| `local/codex/funnel-browser-harness-20260920-next` | `2efcd44cf1cf` | 變更檔案與 master 相同 | branch 變更面與 master blob 差異為 0 |
| `local/codex/funnel-commerce-order-bump` | `bc7efc04a196` | 已合併 PR，commit 在 master | [#269](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/269)；`ae309424d23a` |
| `local/codex/funnel-commerce-service-20260921` | `2815913214cf` | 已合併 PR，commit 在 master | [#247](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/247)；`84095c352cac` |
| `local/codex/funnel-create-20260921` | `435aaaf11895` | 已合併 PR，commit 在 master | [#249](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/249)；`cbc43cddb160` |
| `local/codex/funnel-crm-manual-voucher-20260921` | `261f34561f58` | 已合併 PR，commit 在 master | [#257](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/257)；`8a43fe33e832` |
| `local/codex/funnel-domain-contracts-20260920` | `059cf57542ac` | 已合併 PR，commit 在 master | [#244](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/244)；`ac2b0844944a` |
| `local/codex/funnel-domain-foundation-20260920` | `5e0984a92d1a` | 已合併 PR，commit 在 master | [#243](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/243)；`ef30f232afd4` |
| `local/codex/funnel-editor-data-20260921` | `c3c2f8685d6b` | 已合併 PR，commit 在 master | [#250](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/250)；`37cb3e6157d8` |
| `local/codex/funnel-editor-navigation-diagnostic-20260928` | `c76d43ed6c74` | 已合併 PR，commit 在 master | [#341](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/341)；`ec7b9aad7451` |
| `local/codex/funnel-editor-ui-20260921` | `b754ecce320c` | 已合併 PR，commit 在 master | [#251](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/251)；`2798d4b9330c` |
| `local/codex/funnel-goal3` | `de515182fc5f` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/funnel-goal3-only` | `b5397dbb45dd` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/funnel-goals-qa` | `afc1152f390e` | 已合併 PR，commit 在 master | [#266](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/266)；`1a97be6e3021` |
| `local/codex/funnel-landing-actions-20260921` | `d8cb02070b49` | 已合併 PR，commit 在 master | [#248](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/248)；`e59a469ae63e` |
| `local/codex/funnel-management-list-20260921` | `39339fbe2711` | 已合併 PR，commit 在 master | [#246](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/246)；`f39c35a06617` |
| `local/codex/funnel-operations-20260920` | `2069f827a8a7` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/funnel-operations-docs-20260922` | `c8e6b79d5b5e` | 已合併 PR，commit 在 master | [#273](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/273)；`a476ce34abdb` |
| `local/codex/funnel-operations-editor-20260921` | `c159f463f169` | 已合併 PR，commit 在 master | [#259](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/259)；`8646590a7ade` |
| `local/codex/funnel-operations-lazy-reports-20260927` | `2759b214ae1a` | 已合併 PR，commit 在 master | [#338](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/338)；`5a9d834d5271` |
| `local/codex/funnel-operations-qa` | `2c8da6f3b523` | 已合併 PR，commit 在 master | [#265](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/265)；`efdd0b98a62b` |
| `local/codex/funnel-operations-single-scope-20260927` | `5a65ff915ad8` | 已合併 PR，commit 在 master | [#337](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/337)；`2702f4aa0cdb` |
| `local/codex/funnel-operations-ui-20260920` | `5cd7a9fe6c52` | 已合併 PR，commit 在 master | [#245](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/245)；`3788c2903d77` |
| `local/codex/funnel-public-checkout-20260921` | `aef27cb2850d` | 已合併 PR，commit 在 master | [#254](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/254)；`e3a0cda5257a` |
| `local/codex/funnel-public-render-diagnostic-20260928` | `1731795f2670` | 已合併 PR，commit 在 master | [#343](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/343)；`229084e477cf` |
| `local/codex/funnel-public-runtime-20260921` | `36f6dce9600a` | 已合併 PR，commit 在 master | [#253](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/253)；`eaf677df9d99` |
| `local/codex/funnel-renderer-runtime-20260920` | `c96788bb4f0f` | 已合併 PR，commit 在 master | [#240](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/240)；`4b494c1a44a1` |
| `local/codex/interaction-card-runtime-20260919` | `228170bb542e` | 已合併 PR，commit 在 master | [#226](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/226)；`8067de8ae300` |
| `local/codex/interaction-card-timeline-20260919` | `0aa714e1b554` | 已合併 PR，commit 在 master | [#223](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/223)；`f07c6415a23b` |
| `local/codex/isolate-mfa-test-env` | `e3d276de2dc2` | 已合併 PR，commit 在 master | [#8](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/8)；`7bd7236fda04` |
| `local/codex/landing-page-qa` | `7c89ef29447f` | 已合併 PR，commit 在 master | [#267](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/267)；`5c7b7713f318` |
| `local/codex/launch-final-handoff-20260924` | `1b2053ea5cd6` | 已合併 PR，commit 在 master | [#276](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/276)；`1bfb974d87f6` |
| `local/codex/launch-handoff-20260924` | `05c45e5713a6` | 已合併 PR，commit 在 master | [#275](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/275)；`f8c9f53abf20` |
| `local/codex/launch-integration-20260924` | `235b496a442c` | 已合併 PR，commit 在 master | [#274](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/274)；`0f1fc3e84b52` |
| `local/codex/launch-receipts-20260928` | `92ed6b707465` | 已合併 PR，commit 在 master | [#342](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/342)；`8b0c84fb0e96` |
| `local/codex/line-oa-delivery-report` | `5b9d599d9444` | 已合併 PR，commit 在 master | [#209](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/209)；`474731474333` |
| `local/codex/line-oa-notification-closure` | `992e945063b5` | 已合併 PR，commit 在 master | [#203](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/203)；`aeb128e9d64c` |
| `local/codex/line-receipt-path-fix` | `7c30ac74cf89` | 已合併 PR，commit 在 master | [#206](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/206)；`731a304cbf69` |
| `local/codex/line-receipt-validation-fix` | `5273069270da` | 已合併 PR，commit 在 master | [#205](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/205)；`45ade1772fef` |
| `local/codex/line-runner-binding-diagnostic` | `c14160e79cae` | 已合併 PR，commit 在 master | [#208](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/208)；`354a1560aa48` |
| `local/codex/line-runner-stage-diagnostic` | `3cf0c7b43c81` | 已合併 PR，commit 在 master | [#207](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/207)；`94c290634913` |
| `local/codex/live-admission-retry-backoff` | `74c619917fb4` | 已合併 PR，commit 在 master | [#149](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/149)；`693f27291589` |
| `local/codex/live-interaction-analytics` | `4f697b30c582` | 已合併 PR，commit 在 master | [#271](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/271)；`154a4908ff1d` |
| `local/codex/live-interaction-contracts-20260919` | `d541ba2909ca` | 已合併 PR，commit 在 master | [#221](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/221)；`3e636a93a015` |
| `local/codex/live-interaction-runtime-20260919` | `4082fc0d4da9` | 已合併 PR，commit 在 master | [#225](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/225)；`fce5bca23774` |
| `local/codex/live-interaction-schema-20260919` | `95e3e786d93a` | 已合併 PR，commit 在 master | [#222](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/222)；`e522cddc6f58` |
| `local/codex/live-media-contract-20260920` | `653c829284a2` | 已合併 PR，commit 在 master | [#227](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/227)；`6eb0fdd003c4` |
| `local/codex/live-question-domain-20260919` | `5e083c2cd222` | 已合併 PR，commit 在 master | [#220](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/220)；`440db405db7c` |
| `local/codex/master-dependency-audit-20260918` | `7f07a5f615ee` | 已核對主線替代內容 | [內容取捨紀錄](branch-integration-conflict-decisions-20261004.md)；[blob／語義證據](branch-integration-content-supersession-20261004.json)；不代表原 SHA 已合併 |
| `local/codex/master-integration-sync-20260918` | `60132971f60d` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/master-receipt-counters-20260918` | `9c2f566381cf` | 已合併 PR，commit 在 master | [#212](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/212)；`f770e2b57663` |
| `local/codex/mobile-consultation-cockpit-20260920` | `d66343c55ab1` | 已合併 PR，commit 在 master | [#232](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/232)；`cdb43100231d` |
| `local/codex/mvp-payuni-e2e-20260903` | `a97485710ea2` | 已合併 PR，commit 在 master | [#164](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/164)；`04e3a71702b4` |
| `local/codex/next-diff-audit-20260922` | `947c03f2e00a` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/one-stop-diff-audit` | `154a4908ff1d` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/one-stop-webinar-flow` | `60132971f60d` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/payuni-callback-amount-validation-20260925` | `1893edb4ea2c` | 已合併 PR，commit 在 master | [#296](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/296)；`6081e044e145` |
| `local/codex/payuni-first-webhook-event-race-20260925` | `6dcf882dcb72` | 已合併 PR，commit 在 master | [#297](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/297)；`d17ca716172f` |
| `local/codex/payuni-preview-return-origin` | `0616beaa1403` | 已合併 PR，commit 在 master | [#185](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/185)；`7b0d445ed3ff` |
| `local/codex/payuni-production-query-hard-blocker` | `abc55736ff4e` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/payuni-query-hard-blocker-20260903` | `45612059ab90` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/payuni-reference-classification-20260927` | `477425468c0c` | 已合併 PR，commit 在 master | [#334](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/334)；`c9f6c7918d3f` |
| `local/codex/payuni-sandbox-external-qa` | `35d8f59341bc` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/payuni-success-idempotency-20260925` | `2c419848945b` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/payuni-webhook-transaction-timeout` | `259083f16449` | 已合併 PR，commit 在 master | [#186](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/186)；`9ebb9ee4c532` |
| `local/codex/postpurchase-upsell-20260921` | `1678c4ce989b` | 已合併 PR，commit 在 master | [#258](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/258)；`bc2cab65af52` |
| `local/codex/pr210-secret-scan-fix` | `e1f38be324e3` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/prelaunch-engineering-20260929` | `863218bba4d6` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/presenter-browser-live-20260922` | `1a4869158420` | 已合併 PR，commit 在 master | [#262](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/262)；`be7c060b766a` |
| `local/codex/provider-presence-20260925` | `20d354db2264` | 變更檔案與 master 相同 | branch 變更面與 master blob 差異為 0 |
| `local/codex/recovery-live-stepper-qa-20260719` | `22f06a69bf79` | 已核對主線替代內容 | [內容取捨紀錄](branch-integration-conflict-decisions-20261004.md)；[blob／語義證據](branch-integration-content-supersession-20261004.json)；不代表原 SHA 已合併 |
| `local/codex/sandbox-order-readonly-20260928` | `ece125426372` | 已合併 PR，commit 在 master | [#345](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/345)；`5d5b81468152` |
| `local/codex/sandbox-payment-only-20260928` | `35a10e40e76d` | 已合併 PR，commit 在 master | [#347](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/347)；`d04595136e4a` |
| `local/codex/schema-project-index-contract-20260920` | `5239a03318f2` | 已合併 PR，commit 在 master | [#237](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/237)；`5ef54db93954` |
| `local/codex/scripted-roles-contract-20260920` | `16fcc2dcd1fb` | 已合併 PR，commit 在 master | [#230](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/230)；`58844d2a3833` |
| `local/codex/staging-additive-migration-20260925` | `66ac53056c19` | 已合併 PR，commit 在 master | [#306](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/306)；`0a4e236e2869` |
| `local/codex/staging-alias-diagnostics-20260925` | `fecab1bb0cd9` | 已合併 PR，commit 在 master | [#312](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/312)；`896bd89646e4` |
| `local/codex/staging-apply-gate-v2-20260925` | `708a8d77072f` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-backup-gate-20260925` | `f669d5b502ce` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-backup-migration-gate-20260925` | `5dcde0f030e3` | 已合併 PR，commit 在 master | [#287](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/287)；`6895bf9c7ab0` |
| `local/codex/staging-blocker-handoff-20260928` | `a92148d4661e` | 已合併 PR，commit 在 master | [#344](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/344)；`5f250e41d619` |
| `local/codex/staging-browser-diagnostic-20260925` | `0b10ff680117` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-browser-flow-20260925` | `0f44aea78434` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-browser-phase-diagnostic-20260926` | `8ffb698da484` | 已合併 PR，commit 在 master | [#317](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/317)；`a484c0f7660d` |
| `local/codex/staging-browser-smoke-20260925` | `bc5cefa06cd6` | 已合併 PR，commit 在 master | [#281](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/281)；`2a78088acad2` |
| `local/codex/staging-current-20260926` | `aa8f35bba6f8` | 已合併 PR，commit 在 master | [#322](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/322)；`6b8c49bdb822` |
| `local/codex/staging-current-followup-20260925` | `a9e830813c9c` | 已合併 PR，commit 在 master | [#295](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/295)；`91075d1a66ad` |
| `local/codex/staging-current-payment-followup-20260925` | `af736f82bdf5` | 已合併 PR，commit 在 master | [#298](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/298)；`a2969b0523cf` |
| `local/codex/staging-current-pr299-20260925` | `4b65e0f653a4` | 已合併 PR，commit 在 master | [#300](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/300)；`03c002b29cb8` |
| `local/codex/staging-current-truth-20260925` | `d1bc40097ce7` | 已合併 PR，commit 在 master | [#289](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/289)；`e65162afe215` |
| `local/codex/staging-db-identity-diagnostics-20260925` | `8c0d2f971f95` | 已合併 PR，commit 在 master | [#309](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/309)；`9c5f8db62452` |
| `local/codex/staging-db-query-classification-20260925` | `e2df9d87f881` | 已合併 PR，commit 在 master | [#310](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/310)；`8dfbf1b8503f` |
| `local/codex/staging-db-safe-query-hints-20260925` | `da30b528099f` | 已合併 PR，commit 在 master | [#311](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/311)；`69cb10a31c0b` |
| `local/codex/staging-diagnostic-source-fetch-20260925` | `0ccd6a0194d6` | 已合併 PR，commit 在 master | [#282](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/282)；`81f0129f692b` |
| `local/codex/staging-encrypted-recovery-drill-20260925` | `92a340318a4b` | 已合併 PR，commit 在 master | [#290](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/290)；`ff43f7d60cce` |
| `local/codex/staging-encrypted-retained-backup-20260925` | `8c0512941bc6` | 已合併 PR，commit 在 master | [#288](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/288)；`e13084f37edf` |
| `local/codex/staging-evidence-handoff-20260925` | `b54827a19bdc` | 已合併 PR，commit 在 master | [#286](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/286)；`de3332c2596d` |
| `local/codex/staging-fixture-diagnostics-20260925` | `067a287259ee` | 已合併 PR，commit 在 master | [#280](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/280)；`cb4b71484375` |
| `local/codex/staging-funnel-create-feedback-20260927` | `9bb5d629e29f` | 已合併 PR，commit 在 master | [#333](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/333)；`ff62d7801a7f` |
| `local/codex/staging-funnel-diagnostic-20260927` | `b038db3927fe` | 已合併 PR，commit 在 master | [#331](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/331)；`31df2c418ed8` |
| `local/codex/staging-funnel-navigation-diagnostic-20260927` | `f10557208f37` | 已合併 PR，commit 在 master | [#335](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/335)；`d8f5f71a43a4` |
| `local/codex/staging-funnel-smoke-20260926` | `04c5bbcaf000` | 已合併 PR，commit 在 master | [#329](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/329)；`62d74d700b3c` |
| `local/codex/staging-isolated-migration-drill-20260925` | `d1fbc07ece9c` | 每個提交均有等價 patch | git cherry 全部為等價提交 |
| `local/codex/staging-isolated-restore-aggregate-20260925` | `06a2af1f2e1c` | 已合併 PR，commit 在 master | [#294](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/294)；`b44c94c822e6` |
| `local/codex/staging-live-receipts-20260928` | `d334f7269b07` | 已合併 PR，commit 在 master | [#348](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/348)；`14e23f8e483c` |
| `local/codex/staging-migration-apply-gate` | `60132971f60d` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-migration-compat-preflight-20260925` | `4c44431c9769` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-migration-recovery-20260925` | `f55417aeaf65` | 已合併 PR，commit 在 master | [#283](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/283)；`7becddfd141a` |
| `local/codex/staging-migration-rollback-history-20260925` | `3b70af025b7d` | 已合併 PR，commit 在 master | [#293](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/293)；`aa916642e865` |
| `local/codex/staging-observability-20260926` | `4fac54930808` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-payuni-binding-attestation-20260925` | `50d6c8d92c9e` | 已合併 PR，commit 在 master | [#291](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/291)；`d67afe611825` |
| `local/codex/staging-preview-cutover-20260928` | `bfb7fc486f8b` | 已合併 PR，commit 在 master | [#346](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/346)；`48145dec23d9` |
| `local/codex/staging-provider-binding-attestation-20260925` | `860560079757` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-r2-image-check-20260926` | `455dcd26cef9` | 已合併 PR，commit 在 master | [#326](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/326)；`a94d894a8b7c` |
| `local/codex/staging-r2-image-diagnostic-20260926` | `6267ecc1a27f` | 已合併 PR，commit 在 master | [#330](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/330)；`a061a69637c1` |
| `local/codex/staging-r2-image-external-read-20260927` | `c59cbf065a8f` | 已合併 PR，commit 在 master | [#332](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/332)；`d453f3204bb7` |
| `local/codex/staging-release-20260926` | `29ba9f6a6f38` | 變更檔案與 master 相同 | branch 變更面與 master blob 差異為 0 |
| `local/codex/staging-release-20260928` | `5d5b81468152` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/staging-runtime-provider-probe-20260925` | `7dba71b835ad` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/staging-smoke-announcer-20260926` | `d21050c4192c` | 已合併 PR，commit 在 master | [#321](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/321)；`965ddb151679` |
| `local/codex/staging-source-handoff-20260926` | `f7c28344527e` | 已合併 PR，commit 在 master | [#323](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/323)；`800abee64aa7` |
| `local/codex/staging-status-20260926` | `ec43e3f5b106` | 已合併 PR，commit 在 master | [#318](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/318)；`a4e40e59f4ee` |
| `local/codex/staging-stream-receipt-20260929` | `50125f2f9e4d` | 已合併 PR，commit 在 master | [#350](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/350)；`bdbae2f53491` |
| `local/codex/staging-validation-diagnostics-20260925` | `2b095e27c902` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/student-portal-action-state-20260920` | `6e6e87f67946` | 已合併 PR，commit 在 master | [#231](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/231)；`4358f103e23b` |
| `local/codex/vendor-feature-toggles-20260922` | `b38b047b9c45` | 已合併 PR，commit 在 master | [#261](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/261)；`947c03f2e00a` |
| `local/codex/webinar-funnel-qa` | `e21c7fc9a7bb` | 已合併 PR，commit 在 master | [#268](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/268)；`645b9163d547` |
| `local/codex/wp2-db-failure-classification` | `74e55f89be70` | 已合併 PR，commit 在 master | [#141](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/141)；`4ddd69cce8b2` |
| `local/codex/wp2-pooler-readonly` | `f82adc4cac81` | 已合併 PR，commit 在 master | [#140](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/140)；`f7716e13e697` |
| `local/codex/wp2-receipt-preservation` | `b946834610ad` | 已合併 PR，commit 在 master | [#138](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/138)；`c791ec484f9e` |
| `local/codex/wp2-restore-extension-placement` | `146f8db0616f` | 已合併 PR，commit 在 master | [#145](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/145)；`d1d4f7b128b0` |
| `local/codex/wp2-squash-lineage` | `2be14ad2650f` | 已合併 PR，commit 在 master | [#139](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/139)；`4620c2145f2f` |
| `local/codex/wp4-binding-annotation-20260903` | `f902d24a78d5` | 已合併 PR，commit 在 master | [#168](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/168)；`2f5621da3792` |
| `local/codex/wp4-binding-preflight-20260903` | `1745f92eabc2` | 已合併 PR，commit 在 master | [#167](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/167)；`81d91cc4f6a5` |
| `local/codex/wp4-browser-network-diagnostic-20260903` | `c457a7c4a795` | 已合併 PR，commit 在 master | [#183](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/183)；`993e3a5c7922` |
| `local/codex/wp4-buyer-callback-retry` | `f9e2f870181f` | 已合併 PR，commit 在 master | [#201](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/201)；`53ba7e92c3c6` |
| `local/codex/wp4-buyer-existing-continuation` | `c3bc84c78216` | 已合併 PR，commit 在 master | [#202](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/202)；`61abd3ca7f77` |
| `local/codex/wp4-buyer-payment-check` | `cfdc9f3d4a77` | 已合併 PR，commit 在 master | [#200](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/200)；`4c0aeefacd0a` |
| `local/codex/wp4-buyer-status-20260926` | `4b6798f63e43` | 已合併 PR，commit 在 master | [#325](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/325)；`1da347b960ed` |
| `local/codex/wp4-callback-proof-20260903` | `0b38bfeb9402` | 已合併 PR，commit 在 master | [#165](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/165)；`1806f4b8d050` |
| `local/codex/wp4-current-preview-recovery` | `ec49b0ea1086` | 已合併 PR，commit 在 master | [#195](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/195)；`6c0c1b1cb95e` |
| `local/codex/wp4-eventual-refund-reconcile` | `b7bfc48857cb` | 每個提交均有等價 patch | git cherry 全部為等價提交 |
| `local/codex/wp4-eventual-refund-reconcile-clean` | `70a1d83f099b` | 已合併 PR，commit 在 master | [#192](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/192)；`4b139105db48` |
| `local/codex/wp4-exact-preview-004ac887` | `a1ffc4a9e5d6` | 已合併 PR，commit 在 master | [#154](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/154)；`cbae30afea6e` |
| `local/codex/wp4-executor-enabled-preview` | `3f6f230d1451` | 已合併 PR，commit 在 master | [#152](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/152)；`90ad3589ce6a` |
| `local/codex/wp4-existing-refund-recovery` | `fea1e5fff68d` | 已合併 PR，commit 在 master | [#194](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/194)；`202d9d239036` |
| `local/codex/wp4-fixed-executor-v3` | `e1105745dcfa` | 已合併 PR，commit 在 master | [#162](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/162)；`979ff0798c88` |
| `local/codex/wp4-fixture-count-20260925` | `fa7368405ac2` | 已合併 PR，commit 在 master | [#316](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/316)；`556e9ee54efa` |
| `local/codex/wp4-fixture-diagnostic-20260925` | `80d90504412b` | 已合併 PR，commit 在 master | [#313](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/313)；`1126875f9c51` |
| `local/codex/wp4-fixture-root-cause-20260903` | `f31ee23bc809` | 已合併 PR，commit 在 master | [#169](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/169)；`a94c442921d6` |
| `local/codex/wp4-http-diagnostic-20260925` | `ff97a2bdc41b` | 已合併 PR，commit 在 master | [#315](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/315)；`9443d2c0e50e` |
| `local/codex/wp4-lineage-candidate-fix-20260903` | `cd3571dd8184` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/wp4-lineage-status-url-fix` | `e18e15efe63c` | 已合併 PR，commit 在 master | [#147](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/147)；`8d5516b32afb` |
| `local/codex/wp4-master-exact-preview` | `065fb82b8dc6` | 已合併 PR，commit 在 master | [#153](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/153)；`004ac887bbd2` |
| `local/codex/wp4-network-error-classification-20260903` | `ec980b7f5c61` | 已合併 PR，commit 在 master | [#180](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/180)；`76cb8847e4b4` |
| `local/codex/wp4-payment-page-host-20260903` | `29d7be61c2f5` | 已合併 PR，commit 在 master | [#181](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/181)；`e707edb834f3` |
| `local/codex/wp4-payuni-browser-stage-20260903` | `500f4477858e` | 已合併 PR，commit 在 master | [#171](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/171)；`dd53f406cb4d` |
| `local/codex/wp4-payuni-navigation-classifier-20260903` | `6666a4d25926` | 已合併 PR，commit 在 master | [#176](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/176)；`cd7561518d33` |
| `local/codex/wp4-payuni-navigation-commit-20260903` | `d25214e463d1` | 已合併 PR，commit 在 master | [#175](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/175)；`f72635200c0e` |
| `local/codex/wp4-payuni-navigation-race-20260903` | `2e21f1092804` | 已合併 PR，commit 在 master | [#172](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/172)；`8891d9630cc3` |
| `local/codex/wp4-payuni-navigation-response` | `e7c139e8a2ce` | 已合併 PR，commit 在 master | [#187](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/187)；`5df78d43fe7e` |
| `local/codex/wp4-payuni-network-cause-20260903` | `edae9d6322aa` | 已合併 PR，commit 在 master | [#178](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/178)；`13675b711fbf` |
| `local/codex/wp4-payuni-scheduled-submit-20260903` | `bf0f85bd3941` | 已合併 PR，commit 在 master | [#173](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/173)；`36014142491c` |
| `local/codex/wp4-payuni-secure-runner` | `20bc8973538c` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/wp4-payuni-secure-runner-20260903` | `20bc8973538c` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `local/codex/wp4-payuni-success-card-20260903` | `dbc340011f94` | 已合併 PR，commit 在 master | [#170](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/170)；`b1e310d3397f` |
| `local/codex/wp4-payuni-vendor-egress-20260903` | `0974dcb6c6d2` | 已合併 PR，commit 在 master | [#174](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/174)；`d4cf6c3ac337` |
| `local/codex/wp4-pin-chromium-payuni-egress-20260903` | `7d162a659789` | 已合併 PR，commit 在 master | [#179](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/179)；`9b7bec3923ec` |
| `local/codex/wp4-preserve-payuni-dns-order-20260903` | `2fe1911f8d6e` | 已合併 PR，commit 在 master | [#182](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/182)；`b1e2fecc8a33` |
| `local/codex/wp4-receipt-fix-20260903` | `eac0a3430df3` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `local/codex/wp4-receipt-remediation-20260903` | `c06fdd1e79e1` | 已合併 PR，commit 在 master | [#163](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/163)；`20bc8973538c` |
| `local/codex/wp4-reconciliation-fallback` | `34133663fdd2` | 已合併 PR，commit 在 master | [#190](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/190)；`7c8b6f65938b` |
| `local/codex/wp4-recovery-database-diagnostics` | `0d862d955918` | 已合併 PR，commit 在 master | [#198](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/198)；`67052972b9da` |
| `local/codex/wp4-recovery-local-classification` | `ba69689e0f01` | 已合併 PR，commit 在 master | [#197](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/197)；`c55a513f8675` |
| `local/codex/wp4-recovery-transaction-stage` | `b8180304f29e` | 已合併 PR，commit 在 master | [#199](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/199)；`4912dc3409a3` |
| `local/codex/wp4-refund-projection-window` | `1052a46d0021` | 已合併 PR，commit 在 master | [#193](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/193)；`431e4f53df36` |
| `local/codex/wp4-refund-rejection-recovery` | `88084d047002` | 已合併 PR，commit 在 master | [#189](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/189)；`ab03493a7030` |
| `local/codex/wp4-reservation-diagnostic-20260903` | `2540d24584e1` | 已合併 PR，commit 在 master | [#184](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/184)；`800746cb49c9` |
| `local/codex/wp4-sandbox-executor-master` | `aecd0d18437d` | 已合併 PR，commit 在 master | [#156](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/156)；`5b25271b3048` |
| `local/codex/wp4-sandbox-executor-v2` | `46a9e36cc66f` | 已合併 PR，commit 在 master | [#159](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/159)；`5a0c89d40329` |
| `local/codex/wp4-secure-runner` | `7b320ff097b3` | 已合併 PR，commit 在 master | [#157](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/157)；`2021ab4f838d` |
| `local/codex/wp4-secure-runner-cbae30af` | `cf33299a3bfc` | 已合併 PR，commit 在 master | [#155](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/155)；`105307348a56` |
| `local/codex/wp4-secure-runner-executor` | `6ef0908be688` | 已合併 PR，commit 在 master | [#160](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/160)；`2ee8e0e1fd08` |
| `local/codex/wp4-secure-runner-master` | `73825fad7f08` | 已合併 PR，commit 在 master | [#146](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/146)；`433bb3f21f54` |
| `local/codex/wp4-source-bound-checkout` | `23fdee6d3027` | 已合併 PR，commit 在 master | [#161](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/161)；`3529e4126fee` |
| `local/codex/wp4-subscription-runner` | `93b4db2c49b6` | 已合併 PR，commit 在 master | [#196](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/196)；`11c16efa14da` |
| `local/codex/wp4-whole-twd-refund` | `0d58cefd68ec` | 已合併 PR，commit 在 master | [#188](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/188)；`9deecf858d95` |
| `local/master` | `584632fcec6f` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `origin/HEAD` | `bdbae2f53491` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `origin/ai-team/isolated-write-smoke-20260712-0405` | `d8c85fbbb39e` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/chore/ai-team-v5.1-migration` | `937f796d25d0` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/accessibility-login-isolation-20260920` | `9f899e446ee4` | 已合併 PR，commit 在 master | [#242](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/242)；`2069f827a8a7` |
| `origin/codex/ai-team-skills-automation-foundation` | `bf45235f8b10` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/announcement-truth-20260926` | `a6eaba1edfd1` | 已合併 PR，commit 在 master | [#319](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/319)；`236ad73cf1fb` |
| `origin/codex/apply-stage-diagnostics-20260925` | `c55069b1cd7c` | 已合併 PR，commit 在 master | [#308](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/308)；`e7d529ef7171` |
| `origin/codex/auto-affiliate-performance-list-bombmy-parity-retry-b07e0e3b` | `38bbb0457189` | 已合併 PR，commit 在 master | [#39](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/39)；`2c3859176909` |
| `origin/codex/auto-auto-add-vendor-member-email-invitation-0ce8f8e8` | `79494a34dcbb` | 已合併 PR，commit 在 master | [#86](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/86)；`c9f09954239a` |
| `origin/codex/auto-auto-affiliate-click-paid-order-attribution-f7538669` | `114689ccd3c4` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-align-settlement-platform-fee-refunds-087dd8f2` | `0f8f58f8b417` | 已合併 PR，commit 在 master | [#68](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/68)；`940c7db1ff81` |
| `origin/codex/auto-auto-block-untracked-checkout-fallback-17dd29e7` | `ebdbf2e0676e` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-checkout-failure-update-fallback-fc6dd84f` | `39b8dedf2ea1` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-checkout-metadata-failure-compensation-5088a79f` | `227c102b7f49` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-checkout-metadata-write-failure-7ce63750` | `b92d3e91a28f` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-checkout-response-no-store-b059af2b` | `1a918f9e2e19` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-checkout-transaction-create-failure-eff9bf94` | `2401481ce4ea` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-clarify-team-report-financial-periods-e85fba2a` | `5b91672e3976` | 已合併 PR，commit 在 master | [#82](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/82)；`6d3ed1aa7e47` |
| `origin/codex/auto-auto-clear-consumed-form-attribution-cookie-0ba12ab0` | `3c7a5c82cfc5` | 已合併 PR，commit 在 master | [#77](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/77)；`7e3b4980f261` |
| `origin/codex/auto-auto-confirm-vendor-member-deactivation-3f8fb123` | `3ace54c10b58` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-dedupe-refund-commission-retries-b8852f88` | `cd26e31cf020` | 已合併 PR，commit 在 master | [#83](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/83)；`922853102f19` |
| `origin/codex/auto-auto-detach-live-from-interaction-script-e8ccc0ff` | `638707f9f043` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-fix-full-refund-affiliate-adjustments-b93d1f46` | `1897c4533a90` | 已合併 PR，commit 在 master | [#84](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/84)；`4f2b197d2c92` |
| `origin/codex/auto-auto-fix-live-analytics-kpi-window-ef3a2883` | `36b38ad22f33` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-guard-late-paid-webhook-commission-32405d2a` | `918b0c8718f3` | 已合併 PR，commit 在 master | [#85](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/85)；`8b54d3d4d81c` |
| `origin/codex/auto-auto-handle-password-reset-email-failure-f444b1d2` | `62fb1655dc47` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-harden-login-rate-limits-367f02af` | `fd315e6c03b5` | 已合併 PR，commit 在 master | [#90](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/90)；`803776ab77a6` |
| `origin/codex/auto-auto-hide-retired-billing-plans-fd8e1c24` | `d901dcd89a97` | 已合併 PR，commit 在 master | [#60](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/60)；`c3d2d9bef42b` |
| `origin/codex/auto-auto-live-analytics-empty-states-cd25b32d` | `30230f4ab63c` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-live-checkout-failure-feedback-7a44bfcb` | `1ff1b5135f72` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-make-payout-csv-download-read-only-f041294c` | `ea9dc38869a4` | 已合併 PR，commit 在 master | [#65](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/65)；`6e759f13fa5c` |
| `origin/codex/auto-auto-mark-checkout-provider-failures-14cc4e06` | `67b3fffd94a1` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-net-monthly-revenue-after-refunds-6776de67` | `36c2582067bb` | 已合併 PR，commit 在 master | [#64](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/64)；`a0287edbaba7` |
| `origin/codex/auto-auto-net-platform-fees-after-refunds-8df43b10` | `04c10ff73a74` | 已合併 PR，commit 在 master | [#67](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/67)；`4ea2578648b1` |
| `origin/codex/auto-auto-persist-interaction-script-reorder-e2e-ffc4cf00` | `320d63b9f515` | 已合併 PR，commit 在 master | [#114](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/114)；`40439294b2da` |
| `origin/codex/auto-auto-persist-interaction-timeline-reorder-a2a160eb` | `b3a393a08f05` | 已合併 PR，commit 在 master | [#56](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/56)；`68a48dc97148` |
| `origin/codex/auto-auto-persist-lead-attribution-through-checkout-5927e20d` | `101b8402ffb4` | 已合併 PR，commit 在 master | [#76](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/76)；`cd6c7da09825` |
| `origin/codex/auto-auto-preserve-payment-occurrence-on-refund-a5b20cc2` | `60f652fecaf1` | 已合併 PR，commit 在 master | [#79](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/79)；`540a033b788c` |
| `origin/codex/auto-auto-prevent-concurrent-manual-refund-overdraw-fd62bbbd` | `f43f5be0d40c` | 已合併 PR，commit 在 master | [#71](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/71)；`5d36eb787b03` |
| `origin/codex/auto-auto-prevent-duplicate-live-checkout-313cb628` | `94e66bdf36b4` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-protect-partner-profile-email-8674ef8a` | `2be8fbb42f91` | 已合併 PR，commit 在 master | [#92](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/92)；`d598c507771e` |
| `origin/codex/auto-auto-rate-limit-mfa-verification-1cc12a43` | `e7abdc1791e6` | 已合併 PR，commit 在 master | [#89](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/89)；`0a1f467b71f3` |
| `origin/codex/auto-auto-rate-limit-password-reset-server-action-a5a9d8df` | `280197db0dad` | 已合併 PR，commit 在 master | [#87](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/87)；`6956acedb1c3` |
| `origin/codex/auto-auto-rate-limit-vendor-member-invitations-eef6dbb2` | `3225b4613ab5` | 已合併 PR，commit 在 master | [#88](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/88)；`6b3a0d106cae` |
| `origin/codex/auto-auto-record-team-conversion-attribution-15e880f4` | `bb610057a913` | 已合併 PR，commit 在 master | [#75](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/75)；`9ddb1ca026dd` |
| `origin/codex/auto-auto-refresh-member-invitation-after-resend-06339e6d` | `69777162d90f` | 已合併 PR，commit 在 master | [#117](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/117)；`dbdba6dda06b` |
| `origin/codex/auto-auto-refresh-team-funnel-audit-8610acda` | `2b122ecef86a` | 已合併 PR，commit 在 master | [#94](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/94)；`a4e4f79c9a7b` |
| `origin/codex/auto-auto-reject-mismatched-payment-webhook-vendor-identifiers-ebbe8cd3` | `64a6ecd00052` | 已合併 PR，commit 在 master | [#58](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/58)；`5f4cfe20c517` |
| `origin/codex/auto-auto-reject-unknown-payment-webhook-provider-bd0fca24` | `57946984b5ad` | 已合併 PR，commit 在 master | [#97](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/97)；`8418b7c74c82` |
| `origin/codex/auto-auto-reject-unscoped-payment-webhooks-87aeb639` | `1be712f431a2` | 已合併 PR，commit 在 master | [#57](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/57)；`d2a2ea221886` |
| `origin/codex/auto-auto-remove-vendor-payout-export-button-7ee25ba0` | `2e4166b5b9c8` | 已合併 PR，commit 在 master | [#66](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/66)；`3bbf38dfd954` |
| `origin/codex/auto-auto-resend-vendor-member-invitation-0253ef56` | `031b47ac5482` | 已合併 PR，commit 在 master | [#91](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/91)；`11eb541e4fdf` |
| `origin/codex/auto-auto-restrict-payment-webhook-provider-79d0e42f` | `f62c724320ba` | 已合併 PR，commit 在 master | [#98](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/98)；`f3c29f1d7272` |
| `origin/codex/auto-auto-retry-serializable-refund-conflicts-1ed9f441` | `7d78e77e7e16` | 已合併 PR，commit 在 master | [#72](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/72)；`7d674682bf91` |
| `origin/codex/auto-auto-scope-billing-usage-monthly-transactions-ae8ec7a1` | `d17f41911b95` | 已合併 PR，commit 在 master | [#61](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/61)；`8c6ba564cc9e` |
| `origin/codex/auto-auto-scope-billing-usage-record-to-current-month-7a2cfa02` | `031f481b9347` | 已合併 PR，commit 在 master | [#63](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/63)；`030fd8834266` |
| `origin/codex/auto-auto-scope-vendor-payouts-page-9673b0b8` | `365070ae5a85` | 已合併 PR，commit 在 master | [#59](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/59)；`ac7b8ac8d71b` |
| `origin/codex/auto-auto-secure-webhook-order-authority-a2605f45` | `acb5b5fa90cd` | 已合併 PR，commit 在 master | [#93](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/93)；`003257dbb55f` |
| `origin/codex/auto-auto-show-team-attributed-conversions-111fb900` | `01c8db6c0263` | 已合併 PR，commit 在 master | [#78](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/78)；`e2e79a67f505` |
| `origin/codex/auto-auto-submit-payuni-checkout-form-8b5a4e44` | `90e3a9d74458` | 已合併 PR，commit 在 master | [#80](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/80)；`c9bcd9dc2928` |
| `origin/codex/auto-auto-team-performance-date-scoped-refunds-c27f8b70` | `912ea80d225c` | 已合併 PR，commit 在 master | [#81](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/81)；`876d54b50be2` |
| `origin/codex/auto-auto-test-admin-analytics-smoke-route-00cb84a4` | `1cf2701dae1c` | 已合併 PR，commit 在 master | [#112](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/112)；`def58fdeedf3` |
| `origin/codex/auto-auto-test-admin-cloudflare-ops-routes-a69e2520` | `e2e85858d813` | 已合併 PR，commit 在 master | [#100](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/100)；`0fbbc646b979` |
| `origin/codex/auto-auto-test-admin-ops-email-route-59f4c2a8` | `f1eec5b0f2c1` | 已合併 PR，commit 在 master | [#101](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/101)；`948d451dff1e` |
| `origin/codex/auto-auto-test-admin-preflight-route-e504cc9b` | `c37c9f801f16` | 已合併 PR，commit 在 master | [#103](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/103)；`7f1a2eb00df2` |
| `origin/codex/auto-auto-test-cloudflare-resource-endpoint-auth-1fc52db7` | `3b01efad1957` | 已合併 PR，commit 在 master | [#95](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/95)；`14fa6d894358` |
| `origin/codex/auto-auto-test-health-api-route-f45fa790` | `53fe02c4122c` | 已合併 PR，commit 在 master | [#104](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/104)；`02e3007866c5` |
| `origin/codex/auto-auto-test-live-stepper-preview-8d4b75c7` | `7f1b3fd26e48` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-test-monitoring-smoke-endpoint-97b0f459` | `5762d2136fee` | 已合併 PR，commit 在 master | [#102](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/102)；`26549b02e6f7` |
| `origin/codex/auto-auto-test-password-reset-confirm-route-3ff4807b` | `1a809d1f918a` | 已合併 PR，commit 在 master | [#106](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/106)；`97fd5e418922` |
| `origin/codex/auto-auto-test-password-reset-request-route-1f04be46` | `53f2e7f0c179` | 已合併 PR，commit 在 master | [#105](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/105)；`ea29edea679c` |
| `origin/codex/auto-auto-test-system-role-library-import-094d9cd7` | `65417af2b0e2` | 已合併 PR，commit 在 master | [#115](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/115)；`1410a6c2649f` |
| `origin/codex/auto-auto-test-team-funnel-pages-route-3c1efddb` | `da20026661e0` | 已合併 PR，commit 在 master | [#108](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/108)；`0cb11ac55053` |
| `origin/codex/auto-auto-test-team-funnel-partner-profile-route-95d86b41` | `3d378de9194e` | 已合併 PR，commit 在 master | [#107](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/107)；`7bed611ab3ca` |
| `origin/codex/auto-auto-test-team-funnel-product-slots-route-8a450add` | `d195a2e71f12` | 已合併 PR，commit 在 master | [#110](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/110)；`3d5bbed3e2cc` |
| `origin/codex/auto-auto-test-team-funnel-share-claim-route-d7f91e7e` | `1d106f93642b` | 已合併 PR，commit 在 master | [#109](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/109)；`da7f06b5f24b` |
| `origin/codex/auto-auto-test-team-funnel-template-publish-route-d6b3a898` | `d953767329c1` | 已合併 PR，commit 在 master | [#111](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/111)；`62b78f575c84` |
| `origin/codex/auto-auto-test-vendor-member-deactivation-399b7b28` | `2cceebba802d` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-test-webhook-retry-job-route-08292622` | `e2a9029b343a` | 已合併 PR，commit 在 master | [#99](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/99)；`f8026a3cb54e` |
| `origin/codex/auto-auto-validate-interaction-script-timestamps-f1ad5709` | `20a9abe0664d` | 已合併 PR，commit 在 master | [#96](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/96)；`e6ae8d374c3d` |
| `origin/codex/auto-auto-validate-manual-refund-fees-a8884f1a` | `07b43774d600` | 已合併 PR，commit 在 master | [#70](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/70)；`729ff986138e` |
| `origin/codex/auto-auto-validate-manual-refund-remaining-amount-a3fa1a59` | `569a24900955` | 已合併 PR，commit 在 master | [#69](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/69)；`9d62c9e5db1d` |
| `origin/codex/auto-auto-validate-refund-settlement-month-436c7d85` | `77f241279fc6` | 已合併 PR，commit 在 master | [#73](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/73)；`642b1dcd11b0` |
| `origin/codex/auto-auto-validate-settlement-month-key-1693da3b` | `c96c178082b1` | 已合併 PR，commit 在 master | [#74](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/74)；`33f5aebd8efb` |
| `origin/codex/auto-auto-vendor-invoice-csv-export-841d59b9` | `c83d2ebcaccc` | 已合併 PR，commit 在 master | [#62](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/62)；`81f82e60dd91` |
| `origin/codex/auto-auto-verify-checkout-referral-attribution-6b406470` | `ded82898a687` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-auto-verify-interaction-timeline-drag-drop-e2e-18a9a618` | `5786ed8594e0` | 已合併 PR，commit 在 master | [#113](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/113)；`fb744ee8ad69` |
| `origin/codex/auto-cloudflare-diagnostics-redaction-regressions-a4b40a18` | `3f0eb497b6c0` | 已合併 PR，commit 在 master | [#27](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/27)；`0b40d921ace1` |
| `origin/codex/auto-cloudflare-production-official-signature-d60049d5` | `c15be272d4dd` | 已合併 PR，commit 在 master | [#34](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/34)；`a7e7baeca546` |
| `origin/codex/auto-csp-report-only-regressions-9f13a855` | `178a83022d02` | 已合併 PR，commit 在 master | [#24](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/24)；`939aef0aa1f9` |
| `origin/codex/auto-csp-report-rate-limit-429-regressions-7c770a60` | `2b775029e9fc` | 已合併 PR，commit 在 master | [#31](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/31)；`4f9afe7dde89` |
| `origin/codex/auto-dashboard-seven-day-conversion-funnel-138c807a` | `72fa82fa8909` | 已合併 PR，commit 在 master | [#11](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/11)；`b66c68aafab5` |
| `origin/codex/auto-dashboard-upcoming-live-countdown-24f1b9e8` | `8b7403849db1` | 已合併 PR，commit 在 master | [#12](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/12)；`885f5c7e46d6` |
| `origin/codex/auto-health-database-ok-e2e-regressions-93737079` | `e0ae3a3938bc` | 已合併 PR，commit 在 master | [#32](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/32)；`89c98676ba25` |
| `origin/codex/auto-job-secret-endpoint-401-regressions-47e6734e` | `06d0bd5a39ef` | 已合併 PR，commit 在 master | [#25](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/25)；`be491b2c0ca7` |
| `origin/codex/auto-live-analytics-conversion-funnel-e52533a7` | `8b3a84774ab1` | 已合併 PR，commit 在 master | [#10](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/10)；`9c1482a04025` |
| `origin/codex/auto-live-stepper-grounded-preview-63bea109` | `f5512bf0f0a2` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/auto-login-rate-limit-audit-e2e-regressions-e8279702` | `7e019b90264b` | 已合併 PR，commit 在 master | [#33](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/33)；`845a3b880af5` |
| `origin/codex/auto-password-reset-ui-smoke-isolated-email-regressions-cf0963fd` | `541049f54c72` | 已合併 PR，commit 在 master | [#29](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/29)；`3951686a75a9` |
| `origin/codex/auto-payment-webhook-test-fixture-isolation-6a70376d` | `cfaffa911571` | 已合併 PR，commit 在 master | [#38](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/38)；`6271a7bbf4c1` |
| `origin/codex/auto-public-json-origin-guard-regressions-ff8b3f06` | `61fb072e380b` | 已合併 PR，commit 在 master | [#26](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/26)；`ca2d60d510e2` |
| `origin/codex/auto-public-route-rate-limit-429-regressions-b7657b95` | `62f3fea56414` | 已合併 PR，commit 在 master | [#28](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/28)；`a7be1520930b` |
| `origin/codex/auto-rate-limit-provider-fail-closed-regressions-1a6eed23` | `f3685f77e182` | 已合併 PR，commit 在 master | [#20](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/20)；`f0e87bd9c63d` |
| `origin/codex/auto-reconcile-cloudflare-integration-report-67363dbd` | `506068c7abdd` | 已合併 PR，commit 在 master | [#37](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/37)；`e0e3f98f35ec` |
| `origin/codex/auto-reconcile-interaction-drag-sort-report-2f84c183` | `851fe73eb250` | 已合併 PR，commit 在 master | [#35](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/35)；`346bb39d8d30` |
| `origin/codex/auto-reconcile-password-reset-mfa-report-8810c4c0` | `e259055eec8e` | 已合併 PR，commit 在 master | [#36](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/36)；`0157d0834738` |
| `origin/codex/auto-security-password-reset-smoke-isolation-regressions-f0bef089` | `8f988acd84fb` | 已合併 PR，commit 在 master | [#30](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/30)；`cd1516f65fcc` |
| `origin/codex/auto-team-funnel-architecture-baseline-30371aa7` | `9ef1b5402af0` | 已合併 PR，commit 在 master | [#40](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/40)；`c8e278918145` |
| `origin/codex/auto-team-funnel-attribution-registration-ef0c2d52` | `01bab501117e` | 已合併 PR，commit 在 master | [#49](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/49)；`28c0e45a9029` |
| `origin/codex/auto-team-funnel-authorization-scope-cc5772e6` | `94680515b90e` | 已合併 PR，commit 在 master | [#45](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/45)；`75a65920d520` |
| `origin/codex/auto-team-funnel-browser-e2e-visual-qa-573eca99` | `83ead8f08614` | 已合併 PR，commit 在 master | [#54](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/54)；`eba39d80b67b` |
| `origin/codex/auto-team-funnel-completion-audit-f3db1725` | `6759087f8c63` | 已合併 PR，commit 在 master | [#55](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/55)；`c294f2256ad6` |
| `origin/codex/auto-team-funnel-domain-model-94474d24` | `8b943327e3ba` | 已合併 PR，commit 在 master | [#44](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/44)；`853bc14a8da1` |
| `origin/codex/auto-team-funnel-dynamic-field-catalog-8aa1c17e` | `0802d766de9d` | 已合併 PR，commit 在 master | [#42](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/42)；`be1e0c2d720b` |
| `origin/codex/auto-team-funnel-dynamic-fields-29600e53` | `e1ac994c91f2` | 已合併 PR，commit 在 master | [#41](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/41)；`d56995c5dcaa` |
| `origin/codex/auto-team-funnel-page-template-services-abd771d4` | `3edd225baaf8` | 已合併 PR，commit 在 master | [#46](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/46)；`ba781afa9671` |
| `origin/codex/auto-team-funnel-partner-page-ui-4665c01d` | `536c22bd6b9e` | 已合併 PR，commit 在 master | [#52](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/52)；`d2dfd563751c` |
| `origin/codex/auto-team-funnel-partner-product-slots-cf93509d` | `08bc28332fb7` | 已合併 PR，commit 在 master | [#47](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/47)；`a6ab29c5f7b6` |
| `origin/codex/auto-team-funnel-performance-reporting-8f344c87` | `10acdee8b51b` | 已合併 PR，commit 在 master | [#53](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/53)；`fc81ff8319c0` |
| `origin/codex/auto-team-funnel-public-page-rendering-68778a80` | `92cb4a4f7176` | 已合併 PR，commit 在 master | [#50](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/50)；`d46485db0c6c` |
| `origin/codex/auto-team-funnel-share-copy-service-d4f832d0` | `0f3aa739f77c` | 已合併 PR，commit 在 master | [#48](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/48)；`e8475d7887a5` |
| `origin/codex/auto-team-funnel-template-management-ui-259d80f4` | `20aaa3fd193c` | 已合併 PR，commit 在 master | [#51](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/51)；`060424112f93` |
| `origin/codex/auto-team-funnel-template-text-renderer-208103e5` | `e6df2099d9d7` | 已合併 PR，commit 在 master | [#43](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/43)；`0a84cc5f4b14` |
| `origin/codex/auto-webhook-retry-worker-regressions-27e3474f` | `b97476218d59` | 已合併 PR，commit 在 master | [#21](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/21)；`faf33ba340e7` |
| `origin/codex/consultation-slot-engine-20260920` | `c166007e5203` | 變更檔案與 master 相同 | branch 變更面與 master blob 差異為 0 |
| `origin/codex/core-ready-20260926b` | `d48b9d6da0c8` | 已合併 PR，commit 在 master | [#324](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/324)；`818b535e460a` |
| `origin/codex/core-ready-status-20260926` | `3185d23fd9f4` | 已合併 PR，commit 在 master | [#339](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/339)；`099e6e2afa2d` |
| `origin/codex/core-staging-acceptance-20260925` | `d8bb7ff57d5a` | 已合併 PR，commit 在 master | [#279](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/279)；`367382d35e6a` |
| `origin/codex/core-staging-integration-20260925` | `5b742338d403` | 已合併 PR，commit 在 master | [#304](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/304)；`1d8bac1cc5ed` |
| `origin/codex/core-staging-remaining-20260929` | `26a4c8880761` | 已合併 PR，commit 在 master | [#349](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/349)；`43809aaf286d` |
| `origin/codex/current-provider-probe-20260925` | `e59d4239fdcc` | 已合併 PR，commit 在 master | [#305](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/305)；`c8d4a1343647` |
| `origin/codex/current-staging-status-20260925` | `2b934cb243a2` | 已合併 PR，commit 在 master | [#314](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/314)；`2efdd7280d76` |
| `origin/codex/dashboard-details-client-20260927` | `bcc4d161013c` | 已合併 PR，commit 在 master | [#340](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/340)；`18dc11e8cd23` |
| `origin/codex/dashboard-details-latency-20260926` | `5fa001fe2365` | 已合併 PR，commit 在 master | [#328](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/328)；`5620f03f86b9` |
| `origin/codex/dashboard-kpi-bounded-reads-20260927` | `c0b681a600dc` | 已合併 PR，commit 在 master | [#336](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/336)；`90b23968e350` |
| `origin/codex/dashboard-stream-diagnostic-20260926` | `ef3dd7da9de8` | 已合併 PR，commit 在 master | [#327](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/327)；`82e178bc1785` |
| `origin/codex/evergreen-webinar-settings` | `4dd249d7c580` | 已合併 PR，commit 在 master | [#270](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/270)；`0c142b020107` |
| `origin/codex/funnel-browser-gate-20260922` | `117e22316146` | 已合併 PR，commit 在 master | [#272](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/272)；`1c47b31df89c` |
| `origin/codex/funnel-browser-harness-20260920` | `2efcd44cf1cf` | 已合併 PR，commit 在 master | [#241](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/241)；`4cad289d4d64` |
| `origin/codex/funnel-commerce-order-bump` | `bc7efc04a196` | 已合併 PR，commit 在 master | [#269](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/269)；`ae309424d23a` |
| `origin/codex/funnel-editor-navigation-diagnostic-20260928` | `c76d43ed6c74` | 已合併 PR，commit 在 master | [#341](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/341)；`ec7b9aad7451` |
| `origin/codex/funnel-goal3-only` | `b5397dbb45dd` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/funnel-operations-docs-20260922` | `c8e6b79d5b5e` | 已合併 PR，commit 在 master | [#273](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/273)；`a476ce34abdb` |
| `origin/codex/funnel-operations-lazy-reports-20260927` | `2759b214ae1a` | 已合併 PR，commit 在 master | [#338](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/338)；`5a9d834d5271` |
| `origin/codex/funnel-operations-single-scope-20260927` | `5a65ff915ad8` | 已合併 PR，commit 在 master | [#337](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/337)；`2702f4aa0cdb` |
| `origin/codex/funnel-public-render-diagnostic-20260928` | `1731795f2670` | 已合併 PR，commit 在 master | [#343](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/343)；`229084e477cf` |
| `origin/codex/funnel-renderer-runtime-20260920` | `c96788bb4f0f` | 已合併 PR，commit 在 master | [#240](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/240)；`4b494c1a44a1` |
| `origin/codex/isolate-mfa-test-env` | `e3d276de2dc2` | 已合併 PR，commit 在 master | [#8](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/8)；`7bd7236fda04` |
| `origin/codex/launch-final-handoff-20260924` | `1b2053ea5cd6` | 已合併 PR，commit 在 master | [#276](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/276)；`1bfb974d87f6` |
| `origin/codex/launch-handoff-20260924` | `05c45e5713a6` | 已合併 PR，commit 在 master | [#275](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/275)；`f8c9f53abf20` |
| `origin/codex/launch-integration-20260924` | `235b496a442c` | 已合併 PR，commit 在 master | [#274](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/274)；`0f1fc3e84b52` |
| `origin/codex/launch-receipts-20260928` | `92ed6b707465` | 已合併 PR，commit 在 master | [#342](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/342)；`8b0c84fb0e96` |
| `origin/codex/line-oa-delivery-report` | `5b9d599d9444` | 已合併 PR，commit 在 master | [#209](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/209)；`474731474333` |
| `origin/codex/line-oa-notification-closure` | `992e945063b5` | 已合併 PR，commit 在 master | [#203](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/203)；`aeb128e9d64c` |
| `origin/codex/line-receipt-path-fix` | `7c30ac74cf89` | 已合併 PR，commit 在 master | [#206](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/206)；`731a304cbf69` |
| `origin/codex/line-receipt-validation-fix` | `5273069270da` | 已合併 PR，commit 在 master | [#205](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/205)；`45ade1772fef` |
| `origin/codex/line-runner-binding-diagnostic` | `c14160e79cae` | 已合併 PR，commit 在 master | [#208](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/208)；`354a1560aa48` |
| `origin/codex/line-runner-stage-diagnostic` | `3cf0c7b43c81` | 已合併 PR，commit 在 master | [#207](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/207)；`94c290634913` |
| `origin/codex/live-admission-retry-backoff` | `74c619917fb4` | 已合併 PR，commit 在 master | [#149](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/149)；`693f27291589` |
| `origin/codex/live-interaction-analytics` | `4f697b30c582` | 已合併 PR，commit 在 master | [#271](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/271)；`154a4908ff1d` |
| `origin/codex/master-dependency-audit-20260918` | `7f07a5f615ee` | 已核對主線替代內容 | [內容取捨紀錄](branch-integration-conflict-decisions-20261004.md)；[blob／語義證據](branch-integration-content-supersession-20261004.json)；不代表原 SHA 已合併 |
| `origin/codex/master-receipt-counters-20260918` | `9c2f566381cf` | 已合併 PR，commit 在 master | [#212](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/212)；`f770e2b57663` |
| `origin/codex/mvp-payuni-e2e-20260903` | `a97485710ea2` | 已合併 PR，commit 在 master | [#164](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/164)；`04e3a71702b4` |
| `origin/codex/one-stop-webinar-flow` | `b7956d803f8d` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/payuni-callback-amount-validation-20260925` | `1893edb4ea2c` | 已合併 PR，commit 在 master | [#296](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/296)；`6081e044e145` |
| `origin/codex/payuni-first-webhook-event-race-20260925` | `6dcf882dcb72` | 已合併 PR，commit 在 master | [#297](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/297)；`d17ca716172f` |
| `origin/codex/payuni-preview-return-origin` | `0616beaa1403` | 已合併 PR，commit 在 master | [#185](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/185)；`7b0d445ed3ff` |
| `origin/codex/payuni-production-query-hard-blocker` | `177554e10d2b` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/payuni-reference-classification-20260927` | `477425468c0c` | 已合併 PR，commit 在 master | [#334](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/334)；`c9f6c7918d3f` |
| `origin/codex/payuni-sandbox-external-qa` | `35d8f59341bc` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/payuni-success-idempotency-20260925` | `6d63dd979309` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/payuni-webhook-transaction-timeout` | `259083f16449` | 已合併 PR，commit 在 master | [#186](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/186)；`9ebb9ee4c532` |
| `origin/codex/prelaunch-engineering-20260929` | `863218bba4d6` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/provider-presence-20260925` | `7026b476f01c` | 已合併 PR，commit 在 master | [#307](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/307)；`2b095e27c902` |
| `origin/codex/sandbox-order-readonly-20260928` | `ece125426372` | 已合併 PR，commit 在 master | [#345](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/345)；`5d5b81468152` |
| `origin/codex/sandbox-payment-only-20260928` | `35a10e40e76d` | 已合併 PR，commit 在 master | [#347](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/347)；`d04595136e4a` |
| `origin/codex/staging-additive-migration-20260925` | `66ac53056c19` | 已合併 PR，commit 在 master | [#306](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/306)；`0a4e236e2869` |
| `origin/codex/staging-alias-diagnostics-20260925` | `fecab1bb0cd9` | 已合併 PR，commit 在 master | [#312](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/312)；`896bd89646e4` |
| `origin/codex/staging-apply-gate-v2-20260925` | `b447582b0ef4` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/staging-backup-gate-20260925` | `f669d5b502ce` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/staging-backup-migration-gate-20260925` | `5dcde0f030e3` | 已合併 PR，commit 在 master | [#287](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/287)；`6895bf9c7ab0` |
| `origin/codex/staging-blocker-handoff-20260928` | `a92148d4661e` | 已合併 PR，commit 在 master | [#344](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/344)；`5f250e41d619` |
| `origin/codex/staging-browser-diagnostic-20260925` | `0b10ff680117` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/staging-browser-flow-20260925` | `3e6bf78b2850` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/staging-browser-phase-diagnostic-20260926` | `8ffb698da484` | 已合併 PR，commit 在 master | [#317](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/317)；`a484c0f7660d` |
| `origin/codex/staging-browser-smoke-20260925` | `bc5cefa06cd6` | 已合併 PR，commit 在 master | [#281](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/281)；`2a78088acad2` |
| `origin/codex/staging-current-20260926` | `aa8f35bba6f8` | 已合併 PR，commit 在 master | [#322](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/322)；`6b8c49bdb822` |
| `origin/codex/staging-current-followup-20260925` | `a9e830813c9c` | 已合併 PR，commit 在 master | [#295](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/295)；`91075d1a66ad` |
| `origin/codex/staging-current-payment-followup-20260925` | `af736f82bdf5` | 已合併 PR，commit 在 master | [#298](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/298)；`a2969b0523cf` |
| `origin/codex/staging-current-pr299-20260925` | `4b65e0f653a4` | 已合併 PR，commit 在 master | [#300](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/300)；`03c002b29cb8` |
| `origin/codex/staging-current-truth-20260925` | `d1bc40097ce7` | 已合併 PR，commit 在 master | [#289](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/289)；`e65162afe215` |
| `origin/codex/staging-db-identity-diagnostics-20260925` | `8c0d2f971f95` | 已合併 PR，commit 在 master | [#309](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/309)；`9c5f8db62452` |
| `origin/codex/staging-db-query-classification-20260925` | `e2df9d87f881` | 已合併 PR，commit 在 master | [#310](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/310)；`8dfbf1b8503f` |
| `origin/codex/staging-db-safe-query-hints-20260925` | `da30b528099f` | 已合併 PR，commit 在 master | [#311](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/311)；`69cb10a31c0b` |
| `origin/codex/staging-diagnostic-source-fetch-20260925` | `0ccd6a0194d6` | 已合併 PR，commit 在 master | [#282](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/282)；`81f0129f692b` |
| `origin/codex/staging-encrypted-recovery-drill-20260925` | `92a340318a4b` | 已合併 PR，commit 在 master | [#290](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/290)；`ff43f7d60cce` |
| `origin/codex/staging-encrypted-retained-backup-20260925` | `8c0512941bc6` | 已合併 PR，commit 在 master | [#288](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/288)；`e13084f37edf` |
| `origin/codex/staging-evidence-handoff-20260925` | `b54827a19bdc` | 已合併 PR，commit 在 master | [#286](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/286)；`de3332c2596d` |
| `origin/codex/staging-fixture-diagnostics-20260925` | `067a287259ee` | 已合併 PR，commit 在 master | [#280](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/280)；`cb4b71484375` |
| `origin/codex/staging-funnel-create-feedback-20260927` | `9bb5d629e29f` | 已合併 PR，commit 在 master | [#333](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/333)；`ff62d7801a7f` |
| `origin/codex/staging-funnel-diagnostic-20260927` | `b038db3927fe` | 已合併 PR，commit 在 master | [#331](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/331)；`31df2c418ed8` |
| `origin/codex/staging-funnel-navigation-diagnostic-20260927` | `f10557208f37` | 已合併 PR，commit 在 master | [#335](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/335)；`d8f5f71a43a4` |
| `origin/codex/staging-funnel-smoke-20260926` | `04c5bbcaf000` | 已合併 PR，commit 在 master | [#329](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/329)；`62d74d700b3c` |
| `origin/codex/staging-isolated-restore-aggregate-20260925` | `06a2af1f2e1c` | 已合併 PR，commit 在 master | [#294](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/294)；`b44c94c822e6` |
| `origin/codex/staging-live-receipts-20260928` | `d334f7269b07` | 已合併 PR，commit 在 master | [#348](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/348)；`14e23f8e483c` |
| `origin/codex/staging-migration-compat-preflight-20260925` | `c68a322805b5` | 已合併 PR，commit 在 master | [#292](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/292)；`472ad3ece2dc` |
| `origin/codex/staging-migration-recovery-20260925` | `f55417aeaf65` | 已合併 PR，commit 在 master | [#283](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/283)；`7becddfd141a` |
| `origin/codex/staging-migration-rollback-history-20260925` | `3b70af025b7d` | 已合併 PR，commit 在 master | [#293](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/293)；`aa916642e865` |
| `origin/codex/staging-observability-20260926` | `4fac54930808` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/staging-payuni-binding-attestation-20260925` | `50d6c8d92c9e` | 已合併 PR，commit 在 master | [#291](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/291)；`d67afe611825` |
| `origin/codex/staging-preview-cutover-20260928` | `bfb7fc486f8b` | 已合併 PR，commit 在 master | [#346](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/346)；`48145dec23d9` |
| `origin/codex/staging-r2-image-check-20260926` | `455dcd26cef9` | 已合併 PR，commit 在 master | [#326](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/326)；`a94d894a8b7c` |
| `origin/codex/staging-r2-image-diagnostic-20260926` | `6267ecc1a27f` | 已合併 PR，commit 在 master | [#330](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/330)；`a061a69637c1` |
| `origin/codex/staging-r2-image-external-read-20260927` | `c59cbf065a8f` | 已合併 PR，commit 在 master | [#332](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/332)；`d453f3204bb7` |
| `origin/codex/staging-release-20260926` | `29ba9f6a6f38` | 變更檔案與 master 相同 | branch 變更面與 master blob 差異為 0 |
| `origin/codex/staging-release-20260928` | `5d5b81468152` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `origin/codex/staging-runtime-provider-probe-20260925` | `6c25a9380413` | 保留，待內容審核 | 見下方相同 head 的保留範圍；不得直接覆蓋 master |
| `origin/codex/staging-smoke-announcer-20260926` | `d21050c4192c` | 已合併 PR，commit 在 master | [#321](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/321)；`965ddb151679` |
| `origin/codex/staging-source-handoff-20260926` | `f7c28344527e` | 已合併 PR，commit 在 master | [#323](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/323)；`800abee64aa7` |
| `origin/codex/staging-status-20260926` | `ec43e3f5b106` | 已合併 PR，commit 在 master | [#318](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/318)；`a4e40e59f4ee` |
| `origin/codex/staging-stream-receipt-20260929` | `50125f2f9e4d` | 已合併 PR，commit 在 master | [#350](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/350)；`bdbae2f53491` |
| `origin/codex/wp2-db-failure-classification` | `74e55f89be70` | 已合併 PR，commit 在 master | [#141](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/141)；`4ddd69cce8b2` |
| `origin/codex/wp2-pooler-readonly` | `f82adc4cac81` | 已合併 PR，commit 在 master | [#140](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/140)；`f7716e13e697` |
| `origin/codex/wp2-receipt-preservation` | `b946834610ad` | 已合併 PR，commit 在 master | [#138](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/138)；`c791ec484f9e` |
| `origin/codex/wp2-restore-extension-placement` | `146f8db0616f` | 已合併 PR，commit 在 master | [#145](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/145)；`d1d4f7b128b0` |
| `origin/codex/wp2-squash-lineage` | `2be14ad2650f` | 已合併 PR，commit 在 master | [#139](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/139)；`4620c2145f2f` |
| `origin/codex/wp4-binding-annotation-20260903` | `f902d24a78d5` | 已合併 PR，commit 在 master | [#168](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/168)；`2f5621da3792` |
| `origin/codex/wp4-binding-preflight-20260903` | `1745f92eabc2` | 已合併 PR，commit 在 master | [#167](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/167)；`81d91cc4f6a5` |
| `origin/codex/wp4-browser-network-diagnostic-20260903` | `c457a7c4a795` | 已合併 PR，commit 在 master | [#183](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/183)；`993e3a5c7922` |
| `origin/codex/wp4-buyer-callback-retry` | `f9e2f870181f` | 已合併 PR，commit 在 master | [#201](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/201)；`53ba7e92c3c6` |
| `origin/codex/wp4-buyer-existing-continuation` | `c3bc84c78216` | 已合併 PR，commit 在 master | [#202](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/202)；`61abd3ca7f77` |
| `origin/codex/wp4-buyer-payment-check` | `cfdc9f3d4a77` | 已合併 PR，commit 在 master | [#200](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/200)；`4c0aeefacd0a` |
| `origin/codex/wp4-buyer-status-20260926` | `4b6798f63e43` | 已合併 PR，commit 在 master | [#325](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/325)；`1da347b960ed` |
| `origin/codex/wp4-callback-proof-20260903` | `0b38bfeb9402` | 已合併 PR，commit 在 master | [#165](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/165)；`1806f4b8d050` |
| `origin/codex/wp4-current-preview-recovery` | `ec49b0ea1086` | 已合併 PR，commit 在 master | [#195](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/195)；`6c0c1b1cb95e` |
| `origin/codex/wp4-eventual-refund-reconcile` | `b7bfc48857cb` | 每個提交均有等價 patch | git cherry 全部為等價提交 |
| `origin/codex/wp4-eventual-refund-reconcile-clean` | `70a1d83f099b` | 已合併 PR，commit 在 master | [#192](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/192)；`4b139105db48` |
| `origin/codex/wp4-exact-preview-004ac887` | `a1ffc4a9e5d6` | 已合併 PR，commit 在 master | [#154](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/154)；`cbae30afea6e` |
| `origin/codex/wp4-exact-preview-800746c` | `800746cb49c9` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `origin/codex/wp4-executor-enabled-preview` | `3f6f230d1451` | 已合併 PR，commit 在 master | [#152](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/152)；`90ad3589ce6a` |
| `origin/codex/wp4-existing-refund-recovery` | `fea1e5fff68d` | 已合併 PR，commit 在 master | [#194](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/194)；`202d9d239036` |
| `origin/codex/wp4-fixed-executor-v3` | `e1105745dcfa` | 已合併 PR，commit 在 master | [#162](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/162)；`979ff0798c88` |
| `origin/codex/wp4-fixture-count-20260925` | `fa7368405ac2` | 已合併 PR，commit 在 master | [#316](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/316)；`556e9ee54efa` |
| `origin/codex/wp4-fixture-diagnostic-20260925` | `80d90504412b` | 已合併 PR，commit 在 master | [#313](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/313)；`1126875f9c51` |
| `origin/codex/wp4-fixture-root-cause-20260903` | `f31ee23bc809` | 已合併 PR，commit 在 master | [#169](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/169)；`a94c442921d6` |
| `origin/codex/wp4-http-diagnostic-20260925` | `ff97a2bdc41b` | 已合併 PR，commit 在 master | [#315](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/315)；`9443d2c0e50e` |
| `origin/codex/wp4-lineage-candidate-fix-20260903` | `caa2645020b4` | 已合併 PR，commit 在 master | [#166](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/166)；`75dd1b85c1c4` |
| `origin/codex/wp4-lineage-status-url-fix` | `e18e15efe63c` | 已合併 PR，commit 在 master | [#147](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/147)；`8d5516b32afb` |
| `origin/codex/wp4-master-979ff07` | `979ff0798c88` | 提交歷史已包含 | git merge-base --is-ancestor PASS |
| `origin/codex/wp4-master-exact-preview` | `065fb82b8dc6` | 已合併 PR，commit 在 master | [#153](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/153)；`004ac887bbd2` |
| `origin/codex/wp4-network-error-classification-20260903` | `ec980b7f5c61` | 已合併 PR，commit 在 master | [#180](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/180)；`76cb8847e4b4` |
| `origin/codex/wp4-payment-page-host-20260903` | `29d7be61c2f5` | 已合併 PR，commit 在 master | [#181](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/181)；`e707edb834f3` |
| `origin/codex/wp4-payuni-browser-stage-20260903` | `500f4477858e` | 已合併 PR，commit 在 master | [#171](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/171)；`dd53f406cb4d` |
| `origin/codex/wp4-payuni-navigation-classifier-20260903` | `6666a4d25926` | 已合併 PR，commit 在 master | [#176](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/176)；`cd7561518d33` |
| `origin/codex/wp4-payuni-navigation-commit-20260903` | `d25214e463d1` | 已合併 PR，commit 在 master | [#175](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/175)；`f72635200c0e` |
| `origin/codex/wp4-payuni-navigation-race-20260903` | `2e21f1092804` | 已合併 PR，commit 在 master | [#172](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/172)；`8891d9630cc3` |
| `origin/codex/wp4-payuni-navigation-response` | `e7c139e8a2ce` | 已合併 PR，commit 在 master | [#187](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/187)；`5df78d43fe7e` |
| `origin/codex/wp4-payuni-network-cause-20260903` | `edae9d6322aa` | 已合併 PR，commit 在 master | [#178](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/178)；`13675b711fbf` |
| `origin/codex/wp4-payuni-scheduled-submit-20260903` | `bf0f85bd3941` | 已合併 PR，commit 在 master | [#173](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/173)；`36014142491c` |
| `origin/codex/wp4-payuni-success-card-20260903` | `dbc340011f94` | 已合併 PR，commit 在 master | [#170](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/170)；`b1e310d3397f` |
| `origin/codex/wp4-payuni-vendor-egress-20260903` | `0974dcb6c6d2` | 已合併 PR，commit 在 master | [#174](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/174)；`d4cf6c3ac337` |
| `origin/codex/wp4-pin-chromium-payuni-egress-20260903` | `7d162a659789` | 已合併 PR，commit 在 master | [#179](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/179)；`9b7bec3923ec` |
| `origin/codex/wp4-preserve-payuni-dns-order-20260903` | `2fe1911f8d6e` | 已合併 PR，commit 在 master | [#182](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/182)；`b1e2fecc8a33` |
| `origin/codex/wp4-receipt-remediation-20260903` | `c1bcc0b58890` | 已合併 PR，commit 在 master | [#163](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/163)；`20bc8973538c` |
| `origin/codex/wp4-reconciliation-fallback` | `34133663fdd2` | 已合併 PR，commit 在 master | [#190](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/190)；`7c8b6f65938b` |
| `origin/codex/wp4-recovery-database-diagnostics` | `0d862d955918` | 已合併 PR，commit 在 master | [#198](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/198)；`67052972b9da` |
| `origin/codex/wp4-recovery-local-classification` | `ba69689e0f01` | 已合併 PR，commit 在 master | [#197](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/197)；`c55a513f8675` |
| `origin/codex/wp4-recovery-transaction-stage` | `b8180304f29e` | 已合併 PR，commit 在 master | [#199](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/199)；`4912dc3409a3` |
| `origin/codex/wp4-refund-projection-window` | `1052a46d0021` | 已合併 PR，commit 在 master | [#193](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/193)；`431e4f53df36` |
| `origin/codex/wp4-refund-rejection-recovery` | `88084d047002` | 已合併 PR，commit 在 master | [#189](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/189)；`ab03493a7030` |
| `origin/codex/wp4-reservation-diagnostic-20260903` | `2540d24584e1` | 已合併 PR，commit 在 master | [#184](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/184)；`800746cb49c9` |
| `origin/codex/wp4-sandbox-executor-master` | `aecd0d18437d` | 已合併 PR，commit 在 master | [#156](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/156)；`5b25271b3048` |
| `origin/codex/wp4-sandbox-executor-v2` | `46a9e36cc66f` | 已合併 PR，commit 在 master | [#159](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/159)；`5a0c89d40329` |
| `origin/codex/wp4-secure-runner` | `7b320ff097b3` | 已合併 PR，commit 在 master | [#157](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/157)；`2021ab4f838d` |
| `origin/codex/wp4-secure-runner-cbae30af` | `cf33299a3bfc` | 已合併 PR，commit 在 master | [#155](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/155)；`105307348a56` |
| `origin/codex/wp4-secure-runner-executor` | `6ef0908be688` | 已合併 PR，commit 在 master | [#160](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/160)；`2ee8e0e1fd08` |
| `origin/codex/wp4-secure-runner-master` | `73825fad7f08` | 已合併 PR，commit 在 master | [#146](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/146)；`433bb3f21f54` |
| `origin/codex/wp4-source-bound-checkout` | `23fdee6d3027` | 已合併 PR，commit 在 master | [#161](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/161)；`3529e4126fee` |
| `origin/codex/wp4-subscription-runner` | `93b4db2c49b6` | 已合併 PR，commit 在 master | [#196](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/196)；`11c16efa14da` |
| `origin/codex/wp4-whole-twd-refund` | `0d58cefd68ec` | 已合併 PR，commit 在 master | [#188](https://github.com/Forty-s-AI-Company/CelebrateDeal/pull/188)；`9deecf858d95` |
| `origin/master` | `bdbae2f53491` | 提交歷史已包含 | git merge-base --is-ancestor PASS |

## 尚待審核的獨立 head

每項原始提交均保留。具體批次、優先級、測試與接手流程見 [未來處理報告](branch-integration-future-work.md)。以下檔案差異是審核候選，不代表應原樣合併。

### `d8c85fbbb39e`

來源：`ai-team/isolated-write-smoke-20260712-0405`, `origin/ai-team/isolated-write-smoke-20260712-0405`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：3；完整路徑收於 JSON inventory 的 `heads.d8c85fbbb39e1a72668fa49df171df49e5ef45d1.remaining_paths`。

- `.github/workflows/ci.yml`
- `docs/ai-team-smoke/isolated-write-smoke.md`
- `package-lock.json`

### `937f796d25d0`

來源：`chore/ai-team-v5.1-migration`, `origin/chore/ai-team-v5.1-migration`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：374；完整路徑收於 JSON inventory 的 `heads.937f796d25d0e27db753b7786ea77ea3e773a686.remaining_paths`。

- `.agents/skills/ai-team-lite/SKILL.md`
- `.ai-team/config/router.json`
- `.ai-team/mcp_server/requirements.txt`
- `.ai-team/mcp_server/server.py`
- `.ai-team/mcp_server/test_server.py`
- `.ai-team/scripts/Invoke-AgyDeep.ps1`
- `.ai-team/scripts/Invoke-AgyFast.ps1`
- `.ai-team/scripts/Invoke-AiTeamProcess.ps1`
- `.ai-team/scripts/Invoke-AiTeamReadOnlyFailover.ps1`
- `.ai-team/scripts/Test-AiTeamHandoff.ps1`
- `.ai-team/scripts/Test-AiTeamResilience.ps1`
- `.github/workflows/ci.yml`
- 其餘 362 個路徑見機器可讀盤點，保留完整列表未截斷。

### `bf45235f8b10`

來源：`codex/ai-team-skills-automation-foundation`, `origin/codex/ai-team-skills-automation-foundation`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：460；完整路徑收於 JSON inventory 的 `heads.bf45235f8b10fa1fded2da0a4c079e5b883cfef0.remaining_paths`。

- `.agents/skills/celebratedeal-attribution-commission/SKILL.md`
- `.agents/skills/celebratedeal-attribution-commission/agents/openai.yaml`
- `.agents/skills/celebratedeal-attribution-commission/references/attribution-state-machine.md`
- `.agents/skills/celebratedeal-browser-qa/SKILL.md`
- `.agents/skills/celebratedeal-browser-qa/agents/openai.yaml`
- `.agents/skills/celebratedeal-browser-qa/references/qa-matrix.md`
- `.agents/skills/celebratedeal-design-system/SKILL.md`
- `.agents/skills/celebratedeal-design-system/agents/openai.yaml`
- `.agents/skills/celebratedeal-design-system/references/design-checklist.md`
- `.agents/skills/celebratedeal-multi-tenant-security/SKILL.md`
- `.agents/skills/celebratedeal-multi-tenant-security/agents/openai.yaml`
- `.agents/skills/celebratedeal-multi-tenant-security/references/tenancy-matrix.md`
- 其餘 448 個路徑見機器可讀盤點，保留完整列表未截斷。

### `3ace54c10b58`

來源：`codex/auto-auto-confirm-vendor-member-deactivation-3f8fb123`, `origin/codex/auto-auto-confirm-vendor-member-deactivation-3f8fb123`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：11；完整路徑收於 JSON inventory 的 `heads.3ace54c10b581285a297c5e95e677178314e1c52.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/components/live-stepper-form.test.tsx`
- `src/components/vendor-member-deactivation-confirmation.test.tsx`
- `src/components/vendor-member-deactivation-confirmation.tsx`

### `638707f9f043`

來源：`codex/auto-auto-detach-live-from-interaction-script-e8ccc0ff`, `origin/codex/auto-auto-detach-live-from-interaction-script-e8ccc0ff`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：15；完整路徑收於 JSON inventory 的 `heads.638707f9f043498136107b38968e49a0c38e9133.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- `src/app/api/auth/password-reset/request/route.ts`
- `src/components/interaction-script-form.test.tsx`
- `src/components/interaction-script-form.tsx`
- 其餘 3 個路徑見機器可讀盤點，保留完整列表未截斷。

### `36b38ad22f33`

來源：`codex/auto-auto-fix-live-analytics-kpi-window-ef3a2883`, `origin/codex/auto-auto-fix-live-analytics-kpi-window-ef3a2883`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：17；完整路徑收於 JSON inventory 的 `heads.36b38ad22f3369e4e5265983e36a7a19ab8eb369.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- `src/app/api/auth/password-reset/request/route.ts`
- 其餘 5 個路徑見機器可讀盤點，保留完整列表未截斷。

### `62fb1655dc47`

來源：`codex/auto-auto-handle-password-reset-email-failure-f444b1d2`, `origin/codex/auto-auto-handle-password-reset-email-failure-f444b1d2`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：13；完整路徑收於 JSON inventory 的 `heads.62fb1655dc47c7156a68a09ee18b42d4120d9b61.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- `src/app/api/auth/password-reset/request/route.ts`
- `src/components/live-stepper-form.test.tsx`
- `src/components/vendor-member-deactivation-confirmation.test.tsx`
- 其餘 1 個路徑見機器可讀盤點，保留完整列表未截斷。

### `30230f4ab63c`

來源：`codex/auto-auto-live-analytics-empty-states-cd25b32d`, `origin/codex/auto-auto-live-analytics-empty-states-cd25b32d`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：17；完整路徑收於 JSON inventory 的 `heads.30230f4ab63c65481324a128ff1369deee073c83.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- `src/app/api/auth/password-reset/request/route.ts`
- 其餘 5 個路徑見機器可讀盤點，保留完整列表未截斷。

### `7f1b3fd26e48`

來源：`codex/auto-auto-test-live-stepper-preview-8d4b75c7`, `origin/codex/auto-auto-test-live-stepper-preview-8d4b75c7`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：6；完整路徑收於 JSON inventory 的 `heads.7f1b3fd26e48a41e9e003c848594fa102000f220.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `src/components/live-stepper-form.test.tsx`

### `2cceebba802d`

來源：`codex/auto-auto-test-vendor-member-deactivation-399b7b28`, `origin/codex/auto-auto-test-vendor-member-deactivation-399b7b28`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：7；完整路徑收於 JSON inventory 的 `heads.2cceebba802dec508faaad166e37fa1e51b09ed5.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `src/app/actions.test.ts`
- `src/components/live-stepper-form.test.tsx`

### `f5512bf0f0a2`

來源：`codex/auto-live-stepper-grounded-preview-63bea109`, `origin/codex/auto-live-stepper-grounded-preview-63bea109`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：3；完整路徑收於 JSON inventory 的 `heads.f5512bf0f0a256bcaf732307cdd330a91dad90e0.remaining_paths`。

- `src/components/live-stepper-form.tsx`
- `src/lib/live-preview.test.ts`
- `src/lib/live-preview.ts`

### `de515182fc5f`

來源：`codex/funnel-goal3`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：242；完整路徑收於 JSON inventory 的 `heads.de515182fc5fbcccbefa348f33ee7fad1d6ca715.remaining_paths`。

- `.ai-team/config/router.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/checkpoint.md`
- `docs/ai-team/evidence/funnel-commerce-20260917/commerce-transport-mock.png`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-04e868e53ece.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-0dfd2b159e20.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-138b2122352e.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-401539c4d6a9.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-44ffc06d7346.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-5d0460940e60.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-614fe0da8b10.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-65872a419f42.json`
- `docs/ai-team/evidence/funnel-commerce-20260917/receipt-6e90012b35d2.json`
- 其餘 230 個路徑見機器可讀盤點，保留完整列表未截斷。

### `b5397dbb45dd`

來源：`codex/funnel-goal3-only`, `origin/codex/funnel-goal3-only`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：932；完整路徑收於 JSON inventory 的 `heads.b5397dbb45ddc4dc15a3059b7dec90b5a7771487.remaining_paths`。

- `.agents/skills/ai-team-lite/SKILL.md`
- `.agents/skills/ai-team-style/SKILL.md`
- `.ai-team/config/router.astra-standard.json`
- `.ai-team/config/router.high.json`
- `.ai-team/config/router.json`
- `.ai-team/config/router.low.json`
- `.ai-team/config/router.pro.json`
- `.ai-team/config/router.style.json`
- `.ai-team/mcp_server/requirements.txt`
- `.ai-team/mcp_server/server.py`
- `.ai-team/mcp_server/test_server.py`
- `.ai-team/scripts/Invoke-AgyDeep.ps1`
- 其餘 920 個路徑見機器可讀盤點，保留完整列表未截斷。

### `60132971f60d`

來源：`codex/master-integration-sync-20260918`, `codex/one-stop-webinar-flow`, `codex/staging-migration-apply-gate`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：1084；完整路徑收於 JSON inventory 的 `heads.60132971f60dbad83aae48ffa6f15d3f57682c6e.remaining_paths`。

- `.agents/skills/ai-team-lite/SKILL.md`
- `.agents/skills/ai-team-style/SKILL.md`
- `.ai-team/config/router.astra-standard.json`
- `.ai-team/config/router.high.json`
- `.ai-team/config/router.json`
- `.ai-team/config/router.low.json`
- `.ai-team/config/router.pro.json`
- `.ai-team/config/router.style.json`
- `.ai-team/mcp_server/requirements.txt`
- `.ai-team/mcp_server/server.py`
- `.ai-team/mcp_server/test_server.py`
- `.ai-team/scripts/Invoke-AgyDeep.ps1`
- 其餘 1072 個路徑見機器可讀盤點，保留完整列表未截斷。

### `abc55736ff4e`

來源：`codex/payuni-production-query-hard-blocker`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：2；完整路徑收於 JSON inventory 的 `heads.abc55736ff4e5ff0c8e39399f4d1571cd0c4e08d.remaining_paths`。

- `src/lib/payment-providers/payuni.test.ts`
- `src/lib/payment-providers/payuni.ts`

### `45612059ab90`

來源：`codex/payuni-query-hard-blocker-20260903`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：2；完整路徑收於 JSON inventory 的 `heads.45612059ab90eb89eae83d418c4af115427370eb.remaining_paths`。

- `src/lib/payment-providers/payuni.test.ts`
- `src/lib/payment-providers/payuni.ts`

### `35d8f59341bc`

來源：`codex/payuni-sandbox-external-qa`, `origin/codex/payuni-sandbox-external-qa`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：145；完整路徑收於 JSON inventory 的 `heads.35d8f59341bcb776e548c69fe874a3f4d1fe2528.remaining_paths`。

- `.ai-team/project.yaml`
- `.github/workflows/ci.yml`
- `.gitignore`
- `.vercelignore`
- `docs/ai-team-payuni-sandbox-qa.md`
- `docs/payuni-sandbox-checkout-runbook.md`
- `docs/production-go-live-checklist.md`
- `docs/staging-production-env-vars.md`
- `eslint.config.mjs`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- 其餘 133 個路徑見機器可讀盤點，保留完整列表未截斷。

### `2c419848945b`

來源：`codex/payuni-success-idempotency-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：3；完整路徑收於 JSON inventory 的 `heads.2c419848945be94d6afec4dd9a0073f6a3ab142f.remaining_paths`。

- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
- `scripts/mvp-payuni-sandbox-e2e.mjs`
- `scripts/mvp-payuni-sandbox-e2e.test.mjs`

### `e1f38be324e3`

來源：`codex/pr210-secret-scan-fix`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：700；完整路徑收於 JSON inventory 的 `heads.e1f38be324e349969a657be376aa1602e804c2dd.remaining_paths`。

- `.agents/skills/ai-team-lite/SKILL.md`
- `.agents/skills/ai-team-style/SKILL.md`
- `.ai-team/config/router.astra-standard.json`
- `.ai-team/config/router.high.json`
- `.ai-team/config/router.json`
- `.ai-team/config/router.low.json`
- `.ai-team/config/router.pro.json`
- `.ai-team/config/router.style.json`
- `.ai-team/mcp_server/requirements.txt`
- `.ai-team/mcp_server/server.py`
- `.ai-team/mcp_server/test_server.py`
- `.ai-team/scripts/Invoke-AgyDeep.ps1`
- 其餘 688 個路徑見機器可讀盤點，保留完整列表未截斷。

### `863218bba4d6`

來源：`codex/prelaunch-engineering-20260929`, `origin/codex/prelaunch-engineering-20260929`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：123；完整路徑收於 JSON inventory 的 `heads.863218bba4d64ee2f97e8db43c19583ea9fdccd8.remaining_paths`。

- `.github/workflows/payuni-live-probe.yml`
- `docs/admin-mfa-hardening-plan.md`
- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
- `docs/codex-goal/DECISIONS_NEEDED.md`
- `docs/codex-goal/PRISMA_INVARIANTS.md`
- `docs/launch/payuni-live-one-time-probe.md`
- `docs/launch/payuni-staging-live-plan-test.md`
- `docs/launch/payuni-token-contract-20260929.md`
- `docs/launch/prelaunch-engineering-receipt-20260929.md`
- `docs/launch/prelaunch-executable-inventory-20260929.md`
- `docs/operations/data-request-and-support-intake-sop.md`
- `docs/operations/merchant-onboarding-readiness-runbook.md`
- 其餘 111 個路徑見機器可讀盤點，保留完整列表未截斷。

### `708a8d77072f`

來源：`codex/staging-apply-gate-v2-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.708a8d77072f6e7d7090c0cbb09721b78a247bd0.remaining_paths`。

- `.github/workflows/staging-migration-apply.yml`
- `docs/launch/staging-migration-apply.md`
- `scripts/staging-migration-apply.mjs`
- `scripts/staging-migration-apply.test.mjs`

### `f669d5b502ce`

來源：`codex/staging-backup-gate-20260925`, `origin/codex/staging-backup-gate-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：6；完整路徑收於 JSON inventory 的 `heads.f669d5b502cebcabbc4d25db50dbdd980d283c71.remaining_paths`。

- `.github/workflows/ci.yml`
- `.github/workflows/secure-staging-validation.yml`
- `docs/launch/secure-staging-runner.md`
- `scripts/secure-staging-runner.mjs`
- `scripts/secure-staging-runner.test.mjs`
- `scripts/secure-staging-workflow-contract.test.mjs`

### `0b10ff680117`

來源：`codex/staging-browser-diagnostic-20260925`, `origin/codex/staging-browser-diagnostic-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：2；完整路徑收於 JSON inventory 的 `heads.0b10ff680117320544ade07a6deda358fb88e20a.remaining_paths`。

- `scripts/staging-browser-smoke.mjs`
- `scripts/staging-browser-smoke.test.mjs`

### `0f44aea78434`

來源：`codex/staging-browser-flow-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.0f44aea78434a3850ecb8c38ba6fb25586cbd0d4.remaining_paths`。

- `.github/workflows/staging-browser-smoke.yml`
- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
- `scripts/staging-browser-smoke.mjs`
- `scripts/staging-browser-smoke.test.mjs`

### `4c44431c9769`

來源：`codex/staging-migration-compat-preflight-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：5；完整路徑收於 JSON inventory 的 `heads.4c44431c9769bef50704bb6183707655eb34883c.remaining_paths`。

- `docs/launch/staging-migration-compat-preflight.md`
- `scripts/staging-migration-compat-preflight.mjs`
- `scripts/staging-migration-compat-preflight.test.mjs`
- `scripts/staging-migration-isolated-replay.mjs`
- `scripts/staging-migration-isolated-replay.test.mjs`

### `4fac54930808`

來源：`codex/staging-observability-20260926`, `origin/codex/staging-observability-20260926`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：2；完整路徑收於 JSON inventory 的 `heads.4fac54930808b3184331aad342dd40cb232d228e.remaining_paths`。

- `scripts/staging-browser-smoke.mjs`
- `scripts/staging-browser-smoke.test.mjs`

### `860560079757`

來源：`codex/staging-provider-binding-attestation-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.8605600797576dd2db003948f30358d1f2a7af78.remaining_paths`。

- `.github/workflows/staging-provider-binding-attestation.yml`
- `docs/launch/staging-provider-binding-attestation.md`
- `scripts/staging-provider-binding-attestation.mjs`
- `scripts/staging-provider-binding-attestation.test.mjs`

### `7dba71b835ad`

來源：`codex/staging-runtime-provider-probe-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.7dba71b835ad1d40b8b7c149fe16e55477a084f6.remaining_paths`。

- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
- `docs/external-service-validation-runbook.md`
- `scripts/staging-provider-readonly-probe.mjs`
- `scripts/staging-provider-readonly-probe.test.mjs`

### `cd3571dd8184`

來源：`codex/wp4-lineage-candidate-fix-20260903`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.cd3571dd818444e51e9c8fec9b3992126ffafd6b.remaining_paths`。

- `scripts/secure-staging-runner.mjs`
- `scripts/secure-staging-runner.test.mjs`
- `src/lib/payment-providers/payuni.test.ts`
- `src/lib/payment-providers/payuni.ts`

### `eac0a3430df3`

來源：`codex/wp4-receipt-fix-20260903`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：150；完整路徑收於 JSON inventory 的 `heads.eac0a3430df3ca0beed06a9c63cbd2cb13414fa7.remaining_paths`。

- `.agents/skills/ai-team-lite/SKILL.md`
- `.ai-team/config/router.json`
- `.ai-team/mcp_server/requirements.txt`
- `.ai-team/mcp_server/server.py`
- `.ai-team/mcp_server/test_server.py`
- `.ai-team/scripts/Invoke-AgyDeep.ps1`
- `.ai-team/scripts/Invoke-AgyFast.ps1`
- `.ai-team/scripts/Invoke-AiTeamProcess.ps1`
- `.ai-team/scripts/Invoke-AiTeamReadOnlyFailover.ps1`
- `.ai-team/scripts/Test-AiTeamHandoff.ps1`
- `.ai-team/scripts/Test-AiTeamResilience.ps1`
- `.github/workflows/ci.yml`
- 其餘 138 個路徑見機器可讀盤點，保留完整列表未截斷。

### `114689ccd3c4`

來源：`origin/codex/auto-auto-affiliate-click-paid-order-attribution-f7538669`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：25；完整路徑收於 JSON inventory 的 `heads.114689ccd3c4746d5bb8981ddc5c5b88bad7b29e.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 13 個路徑見機器可讀盤點，保留完整列表未截斷。

### `ebdbf2e0676e`

來源：`origin/codex/auto-auto-block-untracked-checkout-fallback-17dd29e7`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：22；完整路徑收於 JSON inventory 的 `heads.ebdbf2e0676e1de46dbef09256c0cb4edb3401c3.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 10 個路徑見機器可讀盤點，保留完整列表未截斷。

### `39b8dedf2ea1`

來源：`origin/codex/auto-auto-checkout-failure-update-fallback-fc6dd84f`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：20；完整路徑收於 JSON inventory 的 `heads.39b8dedf2ea140bc264088c9d1843d99196586ff.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 8 個路徑見機器可讀盤點，保留完整列表未截斷。

### `227c102b7f49`

來源：`origin/codex/auto-auto-checkout-metadata-failure-compensation-5088a79f`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：25；完整路徑收於 JSON inventory 的 `heads.227c102b7f49221a9d0fea17536ce2ed9e82312c.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 13 個路徑見機器可讀盤點，保留完整列表未截斷。

### `b92d3e91a28f`

來源：`origin/codex/auto-auto-checkout-metadata-write-failure-7ce63750`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：20；完整路徑收於 JSON inventory 的 `heads.b92d3e91a28f41e3f0fb219db5ad5b80746c387b.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 8 個路徑見機器可讀盤點，保留完整列表未截斷。

### `1a918f9e2e19`

來源：`origin/codex/auto-auto-checkout-response-no-store-b059af2b`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：25；完整路徑收於 JSON inventory 的 `heads.1a918f9e2e1974abc229c4bd76d97d17b398bf63.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 13 個路徑見機器可讀盤點，保留完整列表未截斷。

### `2401481ce4ea`

來源：`origin/codex/auto-auto-checkout-transaction-create-failure-eff9bf94`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：20；完整路徑收於 JSON inventory 的 `heads.2401481ce4ea07b1bb7448c62be0db589b73c85e.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 8 個路徑見機器可讀盤點，保留完整列表未截斷。

### `1ff1b5135f72`

來源：`origin/codex/auto-auto-live-checkout-failure-feedback-7a44bfcb`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：25；完整路徑收於 JSON inventory 的 `heads.1ff1b5135f723c2da1e4509625284c376d8cf83e.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 13 個路徑見機器可讀盤點，保留完整列表未截斷。

### `67b3fffd94a1`

來源：`origin/codex/auto-auto-mark-checkout-provider-failures-14cc4e06`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：20；完整路徑收於 JSON inventory 的 `heads.67b3fffd94a107c55e6ec4a8a1441645283e6ad0.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 8 個路徑見機器可讀盤點，保留完整列表未截斷。

### `94e66bdf36b4`

來源：`origin/codex/auto-auto-prevent-duplicate-live-checkout-313cb628`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：23；完整路徑收於 JSON inventory 的 `heads.94e66bdf36b446b12a05dc3312f0d12eeb86421f.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 11 個路徑見機器可讀盤點，保留完整列表未截斷。

### `ded82898a687`

來源：`origin/codex/auto-auto-verify-checkout-referral-attribution-6b406470`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：25；完整路徑收於 JSON inventory 的 `heads.ded82898a687220496add74827691676e84c8b31.remaining_paths`。

- `.ai-team/project.yaml`
- `.env.example`
- `docs/ai-team-payuni-sandbox-qa.md`
- `package.json`
- `scripts/payuni-sandbox-external-qa.mjs`
- `scripts/payuni-sandbox-external-qa.test.mjs`
- `src/app/(app)/lives/[id]/analytics/page.test.tsx`
- `src/app/(app)/lives/[id]/analytics/page.tsx`
- `src/app/(app)/settings/security/page.tsx`
- `src/app/actions.test.ts`
- `src/app/actions.ts`
- `src/app/api/auth/password-reset/request/route.test.ts`
- 其餘 13 個路徑見機器可讀盤點，保留完整列表未截斷。

### `b7956d803f8d`

來源：`origin/codex/one-stop-webinar-flow`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：1085；完整路徑收於 JSON inventory 的 `heads.b7956d803f8dfebbbfdb3a4faeff497ab4bc140e.remaining_paths`。

- `.agents/skills/ai-team-lite/SKILL.md`
- `.agents/skills/ai-team-style/SKILL.md`
- `.ai-team/config/router.astra-standard.json`
- `.ai-team/config/router.high.json`
- `.ai-team/config/router.json`
- `.ai-team/config/router.low.json`
- `.ai-team/config/router.pro.json`
- `.ai-team/config/router.style.json`
- `.ai-team/mcp_server/requirements.txt`
- `.ai-team/mcp_server/server.py`
- `.ai-team/mcp_server/test_server.py`
- `.ai-team/scripts/Invoke-AgyDeep.ps1`
- 其餘 1073 個路徑見機器可讀盤點，保留完整列表未截斷。

### `177554e10d2b`

來源：`origin/codex/payuni-production-query-hard-blocker`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：2；完整路徑收於 JSON inventory 的 `heads.177554e10d2bfa4e500173b5b0557904d3d5b749.remaining_paths`。

- `src/lib/payment-providers/payuni.test.ts`
- `src/lib/payment-providers/payuni.ts`

### `6d63dd979309`

來源：`origin/codex/payuni-success-idempotency-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：3；完整路徑收於 JSON inventory 的 `heads.6d63dd9793091309208f55b5ec132699ec839d0e.remaining_paths`。

- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
- `scripts/mvp-payuni-sandbox-e2e.mjs`
- `scripts/mvp-payuni-sandbox-e2e.test.mjs`

### `b447582b0ef4`

來源：`origin/codex/staging-apply-gate-v2-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.b447582b0ef45bf920ddc5196801048ce787489e.remaining_paths`。

- `.github/workflows/staging-migration-apply.yml`
- `docs/launch/staging-migration-apply.md`
- `scripts/staging-migration-apply.mjs`
- `scripts/staging-migration-apply.test.mjs`

### `3e6bf78b2850`

來源：`origin/codex/staging-browser-flow-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.3e6bf78b2850373e1989b51666cd129798a93b70.remaining_paths`。

- `.github/workflows/staging-browser-smoke.yml`
- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
- `scripts/staging-browser-smoke.mjs`
- `scripts/staging-browser-smoke.test.mjs`

### `6c25a9380413`

來源：`origin/codex/staging-runtime-provider-probe-20260925`

下一步：比對以下變更與現行 master；先保留現行安全與資料契約，將真正新增工作拆成可測試段落，通過必要 CI 後以受保護 PR 合併。

差異檔案數：4；完整路徑收於 JSON inventory 的 `heads.6c25a938041304a86617648e299815526131f0fd.remaining_paths`。

- `docs/codex-goal/API_CONTRACT_REGISTRY.md`
- `docs/external-service-validation-runbook.md`
- `scripts/staging-provider-readonly-probe.mjs`
- `scripts/staging-provider-readonly-probe.test.mjs`
