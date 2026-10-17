# WP-20 實際 Next／瀏覽器來源封存整合

狀態：IN_PROGRESS；WP-20 NOT_READY。這個 checkpoint 驗證來源 INSERT frontier，完整五項統計仍未驗收，Goal維持8/20（40%）。

## 實測結果與對照

使用owned temporary mirror的實際Next.js、Chromium與129 migrations的disposable PostgreSQL。瀏覽器報名頁初訪、重新整理、觀看頁共3 page sources、3 intents、3 visits、1 visitor；6次實際prepare/visit API都是200。

之後加入兩筆真實admission，刻意不由gateway轉送，settle為interrupted。關閉browser並停止/排空gateway後，對同一profile Next送內部簽署的封存前對照GET，它實際新增第4筆page source，沒有JS hydration，所以仍只有3 visits/intents。另一筆late frame仍未使用，private predicate在stop後、seal前明確回true。

封存得到5 frames／4 pages／0 playback intake。相同late frame的predicate變成false；實際Next簽署GET回200，但來源維持4筆；trusted SQL INSERT也被23514拒絕。未配對的interrupted frame由實際DB查詢得到1筆，並確認包含late frame；不是寫死的收據數值。封存前後的4 pages與3 visits是不同計數，不能混用。

mutation只在一個owned DB transaction內執行：讀取當前private predicate定義、移除精確seal判斷，確認predicate回true且原本被拒的INSERT實際寫入1筆；隨即丟出固定rollback錯誤。回滾後predicate重新false、來源仍4筆、未配對仍1筆。停止owned Next後再次對帳來源與seal均未變。這不是降低正式assertion，也未保留弱化function或測試寫入。

當前收據有11項runtime checks PASS；126 targeted units、lint、full typecheck與129 migrations／container/tempRoot/browser/gateway/link cleanup PASS。父runner記錄固定files及esbuild實際local inputs的執行前hash，完成後再次核對；bundle沒有db.ts singleton。DB marker與owned tempRoot/.marker精確相等。這些是局部dependency snapshot，不是完整mirror或parent process isolation認證。

## 複審與失敗保留

最初review MAJOR指出只看封存後沒增加，可能是其他條件拒絕。新增實際Next封存前positive control、stop後/ seal前true與seal後false、trusted SQL23514、真實mutation INSERT/rollback及stop後對帳。最初4 frames/3 pages收據保留為before-discriminating-control，不能作當前證據。

追加對照時曾有allowed局部變數與mirror副檔名allowlist同名，Node在module parse階段拒絕，未啟動DB/browser；改名sourceAllowed後syntax/lint與runtime通過。第一次followup review供應改名前snapshot，因此不能拿它聲稱current hash吻合；最新current review/source為準，原始findings不改寫。

review採ai-team-pro router、external readonly sequential；供應parent fixture全文、seal helper全文與probe新增seal/finally區塊，先前browser transport等未重新供應。credential declaration行明確省略，不宣稱它們經外部審查。actual observed/provider/effort/fallback與findings見next-seal-current-review.json，不能把review完成當整包READY。

## 尚未驗證與風險

最新current review保留MINOR：raw SQL與mutation已直接證明seal的DB防線；Next late GET只觀察HTTP200/未新增source，沒有內部拒絕原因。原check名稱包含Rejected，不能據此斷言Next內部一定因seal拒絕。前後對照排除了「stopped run一律不能寫」，但不是Next路徑本身的mutation測試。未開啟raw DB/請求logs來取得證明。

late/control GET只驗證HTTP200與bounded body，沒有確認完整表單body或UI正常；既有metrics影響表單的MAJOR仍開啟。當前browser仍有5次未知auxiliary阻擋、4次RESOURCE_LOAD console errors；不宣稱全UI/hydration通過。前輪間歇page helper回null、舊SSI7/13／HTTP失敗仍未確認根因，這輪成功不能宣稱已修復。

兩筆interrupted frame、內部direct Next control與未配對來源都保留，因此本例刻意不是positive coverage。固定manifest與fixture auxiliary/HMR proxy不證明全部入口/RSC/query/alias閉合；minimum deployed role、source epoch、typed positive visits/viewing producer、媒體觀看與完整非零五項M1/M2仍未完成。seal只凍結page/intake INSERT，不凍結lossAt/visits/intents/sessions/receipts；125 unsupported-covered gate保留。

## Ownership、回滾與下一步

唯一writer root；requested/effective ai-team-pro，router Sol/xhigh，root observed model/effort unknown；depth1/parallel1/automatic_spawn=false。所有操作在獨立worktree C:/Users/eden/.codex/worktrees/product-audit-goal-plan/CelebrateDeal，base efb8b7e9；原dirty工作樹未操作。沒有commit/push/deploy或Production/正式資料，沒有讀.env*/Secret Store或輸出憑證/raw logs。現有push/PR lint/unit CI未改，本輪沒有遠端CI執行。

回滾停用owned collection，停止owned app/gateway且不再注入profile；保留seal/source/frame/gap與migrations/125 gate，不能解封同版本、逆向migration、刪資料或降低revision。mutation已回滾，臨時容器/鏡像已清理。

下一步補完整入口與minimum role、真正source epoch/typed positive visits+viewing producer，再驗收40%、60%、66.67%、83.33秒、50%。7天只用於完看後訂單資格。D2～D6依賴WP保持WAITING_AUTHORIZATION並跳過。

Evidence根目錄：docs/ai-team/evidence/product-audit-20261011/WP-20/coverage/，主要為next-seal-{route,db,validation,current-review,current-review-source,checkpoint,changed-files,failure-disposition}.json。
