# Stream 手測用直播封面 fixture

`staging-stream-poster.jpg` 只給 `staging-stream-playback-browser` 的 `scenario=manual` 使用：在直播設定精靈「內容 → 進階設定 → 直播封面」
用畫面上的上傳欄位上傳（與商家相同的流程：presign → 上傳到 staging R2 → complete），成為示範直播的海報。開播前它是等候室的滿版背景，
也是等候影片的預覽圖。

本機產生的 1280×720 JPEG：深藍底，中央大字「即將開播」，下方一行「Stream Playback QA 合成海報」。沒有使用者資料。
大小 39183 bytes（約 38 KB）；SHA-256：`645b2f9ac26002a613a0479c20d7e218d1065d97a9d77bc6b937677229730092`。
上傳時畫面會依裁切設定重新編碼成 JPEG，所以 R2 上的位元組不等於這個檔案。

產生方式（不同 ffmpeg 版本不保證相同位元組；字型用 Windows 的微軟正黑體）：

```sh
ffmpeg -f lavfi -i "color=c=0x1e3a8a:s=1280x720:d=1,format=yuv420p,drawbox=x=0:y=470:w=1280:h=250:color=0x0f172a@0.85:t=fill,drawtext=fontfile='C\:/Windows/Fonts/msjhbd.ttc':text='即將開播':fontsize=160:fontcolor=white:borderw=6:bordercolor=0x0f172a:x=(w-text_w)/2:y=200,drawtext=fontfile='C\:/Windows/Fonts/msjh.ttc':text='Stream Playback QA 合成海報':fontsize=44:fontcolor=0xe2e8f0:x=(w-text_w)/2:y=560" \
  -frames:v 1 -q:v 4 -map_metadata -1 -fflags +bitexact -flags:v +bitexact staging-stream-poster.jpg
```

`scripts/staging-stream-playback-browser.mjs` 在上傳前驗證大小及 SHA-256。每次 manual 執行都會新增一張封面圖（合成商家的圖片庫中一筆，數十 KB）。
