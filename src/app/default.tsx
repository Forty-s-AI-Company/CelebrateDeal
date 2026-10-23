import { notFound } from "next/navigation";

// Next 16.4 預設啟用 strict route matching：根 layout 有 @checkout 平行 slot，
// 其 [...catchAll] 會比對到只有 route handler 的網址（/api/*、匯出檔等），
// 因此 children slot 也必須有明確 default。這裡維持既有行為：沒有頁面的
// 網址一律回 404（等同 Next 內建的 children 預設），route handler 不受影響。
export default function RootChildrenDefault() {
  notFound();
}
