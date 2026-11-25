# Stream 簽章播放瀏覽器驗證 fixture

`staging-stream-fifty-five-minutes.mp4` 是本機產生的 55 分鐘（3300 秒）、64×64、2 fps、無音訊藍色畫面，沒有使用者資料。
大小 161162 bytes；SHA-256：`ef3a94eda6b02c64f2858239bbe675b6c242b9434e13b5015f96d6939b08d950`。

長度要超過回放 token 第一次續期（約第 28 分鐘）之後還能繼續播放：hls.js 對極低位元率影片會預先緩衝到約 10 分鐘，
55 分鐘的影片在第 28 分鐘續期後仍會持續請求新的 segment，才觀察得到新 token 的請求。

產生方式（不同 ffmpeg 版本不保證相同位元組）：

```sh
ffmpeg -f lavfi -i color=c=blue:s=64x64:r=2 -t 3300 -an -c:v libx264 -pix_fmt yuv420p -g 20 -bf 0 \
  -movflags +faststart -map_metadata -1 -fflags +bitexact -flags:v +bitexact synthetic.mp4
```

`scripts/staging-stream-playback-browser.mjs` 在上傳前驗證長度及 SHA-256；同一個合成商家（WP4 fixture）只上傳一次，
之後的執行以固定標題找回同一支影片重複使用，不會每次新增 Cloudflare 儲存分鐘。
