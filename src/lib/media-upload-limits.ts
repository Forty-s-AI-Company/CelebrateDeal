// Cloudflare Stream 的 basic direct upload 上限；更大的檔案必須改走 resumable upload。
export const MAX_BASIC_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024;

// Cloudflare Stream 單檔上限。大於 basic 上限的影片會以 tus 分塊續傳。
export const MAX_CLOUDFLARE_VIDEO_BYTES = 30 * 1024 * 1024 * 1024;

// Cloudflare 建議可靠連線使用 50 MiB，且必須是 256 KiB 的整數倍。
export const CLOUDFLARE_TUS_CHUNK_BYTES = 50 * 1024 * 1024;
