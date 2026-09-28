# Stream 合成 fixture

`staging-stream-one-second.mp4` 是本機產生的一秒、64×64、10 fps、無音訊藍色畫面，沒有使用者資料。
大小 1854 bytes；SHA-256：`e1a9583558dff635ef945db4c2d1dd03e443bbef651a929a96f8491f9d8beb42`。

產生方式（不同 ffmpeg 版本不保證相同位元組）：

```sh
ffmpeg -f lavfi -i color=c=blue:s=64x64:r=10 -t 1 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart synthetic.mp4
```

runner 使用提交的固定 fixture 並在外部寫入前驗證長度及 SHA-256。保留新建資源，不自動刪除；本次成功不代表 Cloudflare account/token 與 Production 隔離。
