# Stream 手測用 manual 示範影片 fixture

`staging-stream-manual-demo.mp4` 只給 `staging-stream-playback-browser` 的 `scenario=manual` 使用（full／quick 仍用 `staging-stream-fifty-five-minutes.mp4`），
是本機產生的 59 分鐘（3540 秒）、320×180、5 fps 影片：畫面中央用大字顯示經過時間（HH:MM:SS），背景色隨時間緩慢變化，
聲音是低音量的 880 Hz 短嗶（每 10 秒一聲、約 0.2 秒），讓人在手機上一眼看得出影片是否真的在播。沒有使用者資料。
大小 5589546 bytes（約 5.3 MB）；SHA-256：`4a8b708a37ab9d8f866af2b6ea5bc24b2c56b55154538fc868ab0a690c172501`。

長度 3540 秒低於直接上傳上限 3600 秒，也長到足以讓 owner 從容觀看倒數、開播與進度。

產生方式（不同 ffmpeg 版本不保證相同位元組；字型用 Windows 的 Arial，Linux 可換成任何等寬／無襯線 TTF）：

```sh
ffmpeg -f lavfi -i "color=c=0x3060c0:s=320x180:r=5,hue=h=t*6,drawtext=fontfile='C\:/Windows/Fonts/arial.ttf':text='%{eif\:t/3600\:d\:2}\:%{eif\:mod(t/60,60)\:d\:2}\:%{eif\:mod(t,60)\:d\:2}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2" \
  -f lavfi -i "aevalsrc='0.15*sin(2*PI*880*t)*lt(mod(t,10),0.2)':s=16000:d=3540" \
  -t 3540 -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -g 50 -bf 0 -c:a aac -b:a 24k -ac 1 \
  -movflags +faststart -map_metadata -1 -fflags +bitexact -flags:v +bitexact -flags:a +bitexact staging-stream-manual-demo.mp4
```

`scripts/staging-stream-playback-browser.mjs` 在上傳前驗證大小及 SHA-256；以固定標題「Stream Playback QA Manual Demo 59min v1」找回，
同一個合成商家（WP4 fixture）只上傳一次，之後的 manual 執行重複使用，不會每次新增 Cloudflare 儲存分鐘。
