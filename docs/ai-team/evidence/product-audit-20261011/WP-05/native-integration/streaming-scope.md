# 原生無JavaScript必要範圍

瀏覽器失敗證據：303已回到原頁，草稿1筆、回填訊息1筆、欄位1筆皆存在，但訊息無法變為可見。根層loading.tsx的Suspense streaming會等待JavaScript切換hidden內容；與原生無JS要求衝突。

主代理唯一writer；先確認這2個loading檔沒有既有diff，將根loading與/p局部loading重新命名為非特殊元件檔，保留原視覺元件及root測試斷言。protected(app)／checkout等各自loading不動。這會讓其他原本只繼承根loading的公開頁等待完整HTML而不顯示全站skeleton；需要回歸與獨立審查，不假裝影響只限form。

src/app/loading.tsx -> src/app/root-loading.tsx
src/app/p/[slug]/loading.tsx -> src/app/p/[slug]/loading-shell.tsx
src/app/loading.test.tsx 只更新import，原斷言保留。

沒有改權限、DB或發布閘門。若新證據否定根因，再反向此精確rename，不使用全域restore。
