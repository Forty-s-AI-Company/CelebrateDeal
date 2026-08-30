# WP-181 — env-run failure classifier

## 結果

`WP181_ALLOWLISTED_FAILURE_UNKNOWN`

Offline classifier 9/9 fixtures通過，涵蓋`AUTH_CHALLENGE_REQUIRED`、`INVALID_TOKEN`、`PROJECT_RESOLUTION`、`ENV_PULL_API`、`CHILD_SPAWN`與`UNKNOWN`，且多重命中必須fail closed為`UNKNOWN`。

唯一一次read-only Preview env-run從乾淨OS-temp cwd執行，exit 1、child marker=false。記憶體中的raw output未唯一命中任何allowlisted failure family，因此正式分類為`UNKNOWN`；沒有將靜態上合理的auth-challenge假設冒充runtime證據。

## Static/runtime boundary

CLI58.4.4 source證明Preview env pull經challenge recovery，三種recoverable auth codes在noninteractive路徑會rethrow；但WP-181 runtime分類沒有證明實際命中該family，因此`LOGIN_REQUIRED=false`。下一步不得以此要求使用者登入或輸入OTP。

## Safety／score

Raw stdout/stderr、env values、token、OTP、cookie與URL均未保存或輸出。Env upsert、rollback、deployment、alias、DB、PayUni、Production、DNS與Git mutation皆為0。原deployment仍為`preview / READY`，staged index空。CAT04維持`6.0/10`，總分維持`72.0/100`。

Temp cwd最終為空；Desktop host policy未允許刪除既有空temp殘留，沒有敏感資料留存。

## AGY Fast QA

兩次唯讀QA都在structured output前遭wrapper empty-line parameter binding error阻擋，保存為`TOOL_BLOCKED`。AGY未執行外部操作，也未取代deterministic classifier evidence。
