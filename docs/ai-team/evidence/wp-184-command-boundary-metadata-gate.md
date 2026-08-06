# WP-184 — Command invocation boundary與安全metadata gate

## 結果

`WP184_CMD_LAUNCHER_ROOT_CAUSE_CONFIRMED_METADATA_FAIL_CLOSED`

Vercel CLI 58.4.4 static control flow證明bare `--version`會在authorization、project resolution與network初始化前return。唯一direct `vercel.cmd --version`為exit0且精確匹配58.4.4；WP-183同型的`.NET ProcessStartInfo → cmd.exe /d /s /c` wrapper為exit1且沒有version marker。

同型wrapper對synthetic Node argv/stdin fixture也exit1，child與stdin marker皆未出現。固定分類為`CMD_QUOTING_OR_LAUNCHER_BOUNDARY`：WP-183兩次exit1發生在CLI child啟動前，不能作為Vercel API拒絕、team policy或binding mutation證據。

## Metadata safety gate

CLI source證明：

- `env ls`一般table會輸出plain/system values。
- JSON listing會明確輸出plain `env.value`。
- `GET /v10/projects/{id}/env`回傳完整env records，沒有field projection或value-free flag。
- 已安裝CLI只對單一env id提供DELETE/PATCH路徑，沒有只回傳name/type的GET endpoint。

因此安全metadata endpoint未證明，metadata request attempts=`0`；沒有讀取env values，binding after維持`UNVERIFIED`。

## 安全、分數與下一步

本包network、env mutation/probe、login、deployment、alias、DB、PayUni、Production、DNS與Git mutation全部為0。Raw output、env values、URL、request ID與credential均未persist/expose。所有既有dirty changes維持`PRESERVE_ONLY`，staged index空。

CAT04維持`6.0/10`、總分維持`72.0/100`。本包只確認WP-183 launcher root cause；下一包若要修復binding，必須另經Sol規劃，改用已由WP-182證明可行的直接PowerShell `& vercel.cmd` invocation，禁止再使用cmd wrapper。

## AGY Fast QA

兩次唯讀QA皆在structured output前發生`FIRST_OUTPUT_TIMEOUT`，依規則保存為`TOOL_BLOCKED`。AGY沒有執行外部操作，也不取代deterministic launcher與source evidence。
