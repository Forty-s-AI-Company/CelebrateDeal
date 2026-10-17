import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PolicyPage, { generateMetadata, generateStaticParams } from "./page";

describe("/policies/[slug] route", () => {
  it("generates one static route for each policy draft", () => {
    expect(generateStaticParams()).toEqual([
      { slug: "terms" },
      { slug: "privacy" },
      { slug: "refunds" },
    ]);
  });

  it("renders a valid policy draft and route metadata", async () => {
    const html = renderToStaticMarkup(await PolicyPage({ params: Promise.resolve({ slug: "refunds" }) }));
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "refunds" }) });

    expect(html).toContain("退款與付款支援政策（草稿）");
    expect(html).toContain("DRAFT — FINANCE／SUPPORT／LEGAL REVIEW REQUIRED");
    expect(metadata.title).toContain("退款與付款支援政策（草稿）");
  });

  it("returns empty metadata for an unknown draft without exposing content", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "unknown" }) });

    expect(metadata).toEqual({});
  });
});
