import type { AnchorHTMLAttributes } from "react";

/**
 * 一律整頁載入的站內連結（不是 next/link 的 client 導覽）。
 *
 * 公開一頁式網站（/lp/*）會載入商家的 GA4／Meta Pixel；若從 /lp 以 client 導覽
 * 進入平台頁（政策、客服、登入、後台），這些商家腳本會留在同一個 window 內繼續
 * 送 page_view。凡是 /lp 文件樹與政策頁上連往非 /lp 路由的連結都用這個元件，
 * 讓瀏覽器重新載入文件、丟掉商家腳本。`src/app/lp/full-page-navigation.test.ts`
 * 走訪 import graph 鎖住這個規則。
 */
export function FullPageLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}
