import { describe, expect, it } from "vitest";

import {
  FUNNEL_SHOWCASE_MAX_ITEMS,
  formatShowcaseStat,
  showcaseAccentParts,
  showcaseCards,
  showcaseColor,
  showcaseDividerPath,
  showcaseIconItems,
  showcaseLogoFilter,
  showcaseLogoItems,
  showcaseNavItems,
  showcaseReadableOn,
  showcaseSocialLinks,
  showcaseStatItems,
  showcaseTestimonialRows,
  showcaseTestimonials,
  showcaseVideos,
  youtubeNoCookieEmbedUrl,
  youtubeVideoId,
} from "./funnel-showcase";

describe("funnel showcase prop readers", () => {
  it("只從常見的 YouTube 網址取出 11 碼影片 id", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    for (const unsafe of ["http://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://evil.example/watch?v=dQw4w9WgXcQ", "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short", "https://user@www.youtube.com/watch?v=dQw4w9WgXcQ", "javascript:alert(1)", 42]) {
      expect(youtubeVideoId(unsafe), String(unsafe)).toBeNull();
    }
    expect(youtubeNoCookieEmbedUrl("dQw4w9WgXcQ")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/u);
  });

  it("影片牆：YouTube 內嵌、其他安全網址另開、不安全網址丟棄", () => {
    const videos = showcaseVideos([
      { url: "https://youtu.be/dQw4w9WgXcQ", title: "A" },
      { url: "https://videos.example/watch/1", title: "B", thumbnail: "/thumb.svg" },
      { url: "javascript:alert(1)", title: "C", thumbnail: "javascript:alert(1)" },
    ]);
    expect(videos[0]).toEqual({ title: "A", youtubeId: "dQw4w9WgXcQ", href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" });
    expect(videos[1]).toEqual({ title: "B", youtubeId: null, href: "https://videos.example/watch/1", thumbnail: "/thumb.svg" });
    expect(videos[2]).toEqual({ title: "C", youtubeId: null, href: null, thumbnail: null });
  });

  it("連結與圖片一律經過 safe-url，項目數有上限", () => {
    const logos = showcaseLogoItems([{ src: "/a.svg", alt: "A", href: "https://a.example" }, { src: "javascript:alert(1)", alt: "x" }, { src: "//evil.example/a.svg" }, { src: "/b.svg", href: "/\\evil.example" }]);
    expect(logos).toEqual([{ src: "/a.svg", alt: "A", href: "https://a.example" }, { src: "/b.svg", alt: "", href: null }]);
    expect(showcaseLogoItems(Array.from({ length: 40 }, () => ({ src: "/a.svg" })))).toHaveLength(FUNNEL_SHOWCASE_MAX_ITEMS);
    const cards = showcaseCards([{ title: "T", src: "data:image/png;base64,AAAA", href: "#top" }, { text: "沒有標題也沒有圖片" }]);
    expect(cards).toEqual([expect.objectContaining({ title: "T", src: null, href: "#top" })]);
    expect(showcaseTestimonials([{ name: "A", rating: 9, avatar: "http://x.example/a.png" }])[0]).toMatchObject({ rating: 5, avatar: null });
  });

  it("導覽列的下拉選單與社群連結", () => {
    const items = showcaseNavItems([{ label: "課程", href: "#courses", submenu: "入門 | #a\n進階 | javascript:alert(1)\n | #b" }, { label: "" }]);
    expect(items).toEqual([{ label: "課程", href: "#courses", children: [{ label: "入門", href: "#a" }, { label: "進階", href: null }] }]);
    expect(showcaseSocialLinks([
      { network: "instagram", href: "https://instagram.example/me" },
      { network: "email", href: "hello@example.com" },
      { network: "email", href: "javascript:alert(1)" },
      { network: "unknown", href: "https://x.example" },
      { network: "x", href: "http://x.example" },
    ])).toEqual([
      { network: "instagram", href: "https://instagram.example/me" },
      { network: "email", href: "mailto:hello@example.com" },
      { network: "facebook", href: "https://x.example" },
    ]);
  });

  it("數據：數字可計數、文字原樣顯示", () => {
    expect(showcaseStatItems([{ value: "12,800", suffix: "+", label: "學員" }, { value: "4.9", label: "評分" }, { value: "24/7", label: "客服" }])).toEqual([
      { value: 12800, display: "12,800", decimals: 0, prefix: "", suffix: "+", label: "學員" },
      { value: 4.9, display: "4.9", decimals: 1, prefix: "", suffix: "", label: "評分" },
      { value: null, display: "24/7", decimals: 0, prefix: "", suffix: "", label: "客服" },
    ]);
    expect(formatShowcaseStat(12800, 0, true)).toBe("12,800");
    expect(formatShowcaseStat(4.9, 1, false)).toBe("4.9");
  });

  it("圖示、色調、分隔形狀與顏色都只接受允許清單", () => {
    expect(showcaseIconItems([{ icon: "<script>", title: "A" }])[0]!.icon).toBe("check");
    expect(showcaseLogoFilter("light")).toBe("brightness(0) invert(1)");
    expect(showcaseLogoFilter("original")).toBeUndefined();
    expect(showcaseDividerPath("triangle", "top")).toBe("M0 0H1200L600 100Z");
    expect(showcaseDividerPath("triangle", "bottom")).toBe("M0 100H1200L600 0Z");
    expect(showcaseColor("#c9a063")).toBe("#c9a063");
    expect(showcaseColor("red; background:url(x)")).toBeUndefined();
  });

  it("標題強調字、徽章文字色與評價分排", () => {
    expect(showcaseAccentParts("把人生的舵，*交回自己手上*")).toEqual([{ text: "把人生的舵，", accent: false }, { text: "交回自己手上", accent: true }]);
    expect(showcaseAccentParts("沒有*強調")).toEqual([{ text: "沒有*強調", accent: false }]);
    expect(showcaseReadableOn("#c9a063")).toBe("#111111");
    expect(showcaseReadableOn("#7d5f32")).toBe("#ffffff");
    expect(showcaseTestimonialRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 3, 5], [2, 4]]);
    expect(showcaseTestimonialRows([1, 2, 3], 2)).toEqual([[1, 2, 3]]);
  });
});
