import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PolicyPage, { generateMetadata, generateStaticParams, revalidate } from "./page";
import { publicPolicies } from "@/lib/public-policy-content";

describe("/policies/[slug] route", () => {
  afterEach(() => vi.useRealTimers());

  it("generates one static route for each public policy", () => {
    expect(generateStaticParams()).toEqual([
      { slug: "terms" },
      { slug: "privacy" },
      { slug: "refunds" },
    ]);
  });

  it("renders a published policy and matching route metadata", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-18T00:00:00+08:00") });
    const html = renderToStaticMarkup(await PolicyPage({ params: Promise.resolve({ slug: "refunds" }) }));
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "refunds" }) });

    expect(html).toContain("退款與付款支援政策");
    expect(html).toContain('data-policy-publication="scheduled"');
    expect(html).toContain(publicPolicies.refunds.publication.version);
    expect(html).toContain(`<time dateTime="${publicPolicies.refunds.publication.effectiveDate}">`);
    expect(html).toContain("通訊交易與數位內容");
    expect(html).toContain("自動電子發票功能尚未開放");
    expect(html).toContain("該筆交易的開立主體會依法開立並提供發票");
    expect(html).toContain("已受理、審核中、已拒絕");
    expect(revalidate).toBe(3600);
    expect(metadata.title).toContain("退款與付款支援政策");
    expect(metadata.description).toContain("退款申請");
    for (const internal of ["DRAFT", "HUMAN", "owner", "P0", "P1", "P2", "provider payload"]) {
      expect(html).not.toContain(internal);
    }
  });

  it("renders the effective state once the Taipei effective date arrives", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T23:59:59+08:00") });
    const before = renderToStaticMarkup(await PolicyPage({ params: Promise.resolve({ slug: "terms" }) }));
    expect(before).toContain('data-policy-publication="scheduled"');
    expect(before).toContain("本版本尚未生效");

    vi.setSystemTime(new Date("2026-11-01T00:00:00+08:00"));
    const after = renderToStaticMarkup(await PolicyPage({ params: Promise.resolve({ slug: "terms" }) }));
    expect(after).toContain('data-policy-publication="published"');
    expect(after).not.toContain("本版本尚未生效");
    expect(after).not.toContain("預定生效日期");
  });

  it("stores publication metadata per policy instead of deriving it from a shared renderer value", () => {
    for (const policy of Object.values(publicPolicies)) {
      expect(policy.publication.version).toBe("2026.10.18");
      expect(policy.publication.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/u);
      expect(policy.publication.effectiveDate).toBe("2026-11-01");
      expect(policy.publication).not.toHaveProperty("status");
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
