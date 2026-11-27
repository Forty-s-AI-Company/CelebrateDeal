# Stream 手測用開播前等候影片 fixture

`staging-stream-waiting-loop.mp4` 只給 `staging-stream-playback-browser` 的 `scenario=manual` 使用，綁成示範直播的「開播前等候影片」
（`Live.waitingVideoId`，owner 2026-11-27）。開播前觀眾進直播間時，它在等候室背景靜音循環播放；開播後由主影片接手。

本機產生的 24 秒、640×360、15 fps 影片：畫面中央大字「等候中」，下方顯示循環中的秒數（`00 / 24 s` 到 `23 / 24 s`），
背景色隨時間變化，最下方一行「Stream Playback QA 等候影片（循環）」。聲音是很小聲的 660 Hz 短音（每 6 秒一聲、約 0.15 秒），
按「開啟聲音」後聽得出來。沒有使用者資料。
大小 216405 bytes（約 212 KB）；SHA-256：`b2fdba87b8e331d12517ce5553486d4c46dd41ecb550d4587f0d21dd098d9251`。

產生方式（不同 ffmpeg 版本不保證相同位元組；字型用 Windows 的微軟正黑體與 Arial，Linux 可換成任何支援中文的 TTF）：

```sh
ffmpeg -f lavfi -i "color=c=0x7c2d12:s=640x360:r=15:d=24,hue=h=t*15,drawbox=x=0:y=300:w=640:h=60:color=0x000000@0.55:t=fill,drawtext=fontfile='C\:/Windows/Fonts/msjhbd.ttc':text='等候中':fontsize=96:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=90,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='%{eif\:t\:d\:2} / 24 s':fontsize=36:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=230,drawtext=fontfile='C\:/Windows/Fonts/msjh.ttc':text='Stream Playback QA 等候影片（循環）':fontsize=22:fontcolor=0xe2e8f0:x=(w-text_w)/2:y=315" \
  -f lavfi -i "aevalsrc='0.08*sin(2*PI*660*t)*lt(mod(t,6),0.15)':s=16000:d=24" \
  -t 24 -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -g 30 -bf 0 -c:a aac -b:a 24k -ac 1 \
  -movflags +faststart -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact staging-stream-waiting-loop.mp4
```

`scripts/staging-stream-playback-browser.mjs` 在上傳前驗證大小及 SHA-256；以固定標題「Stream Playback QA Waiting Loop 24s v1」找回，
同一個合成商家（WP4 fixture）只上傳一次，之後的 manual 執行重複使用。
