import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PolicyPage, { generateMetadata, generateStaticParams } from "./page";
import { publicPolicies } from "@/lib/public-policy-content";

describe("/policies/[slug] route", () => {
  it("generates one static route for each public policy", () => {
    expect(generateStaticParams()).toEqual([
      { slug: "terms" },
      { slug: "privacy" },
      { slug: "refunds" },
    ]);
  });

  it("renders a published policy and matching route metadata", async () => {
    const html = renderToStaticMarkup(await PolicyPage({ params: Promise.resolve({ slug: "refunds" }) }));
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "refunds" }) });

    expect(html).toContain("退款與付款支援政策");
    expect(html).toContain('data-policy-publication="scheduled"');
    expect(html).toContain(publicPolicies.refunds.publication.version);
    expect(html).toContain(`<time dateTime="${publicPolicies.refunds.publication.effectiveDate}">`);
    expect(html).toContain("通訊交易與數位內容");
    expect(html).toContain("自動電子發票功能尚未開放");
    expect(html).toContain("不會免除實際開立義務人依法應開立");
    expect(metadata.title).toContain("退款與付款支援政策");
    expect(metadata.description).toContain("退款申請");
    for (const internal of ["DRAFT", "HUMAN", "owner", "P0", "P1", "P2", "provider payload"]) {
      expect(html).not.toContain(internal);
    }
  });

  it("stores publication metadata per policy instead of deriving it from a shared renderer value", () => {
    for (const policy of Object.values(publicPolicies)) {
      expect(policy.publication.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/u);
      expect(policy.publication.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(policy.publication.status).toBe("scheduled");
    }
    expect(publicPolicies.terms.publication).not.toBe(publicPolicies.privacy.publication);
    expect(publicPolicies.privacy.publication).not.toBe(publicPolicies.refunds.publication);
  });

  it("returns empty metadata and a real 404 for unknown or inherited names", async () => {
    for (const slug of ["unknown", "constructor", "toString", "__proto__"]) {
      expect(await generateMetadata({ params: Promise.resolve({ slug }) })).toEqual({});
      await expect(PolicyPage({ params: Promise.resolve({ slug }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    }
  });
});
