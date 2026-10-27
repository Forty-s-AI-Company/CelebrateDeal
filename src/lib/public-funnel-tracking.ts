import { getDb } from "@/lib/db";
import { normalizeLandingPageSlug, publicLandingPageCandidateWhere } from "@/lib/public-landing-page-eligibility";
import { publicTrackingTags, type PublicTrackingTags } from "@/lib/tracking-integration-ids";

/**
 * 公開一頁式網站的瀏覽器追蹤 ID（GA4、Meta Pixel）。只讀取與公開頁相同
 * 公開條件、slug 唯一的頁面所屬商家設定；任何錯誤都不載入追蹤碼。
 */
export async function loadPublicFunnelTrackingTags(slug: string): Promise<PublicTrackingTags> {
  const safeSlug = normalizeLandingPageSlug(slug);
  if (!safeSlug) return {};
  try {
    const pages = await getDb().landingPage.findMany({
      where: publicLandingPageCandidateWhere(safeSlug),
      take: 2,
      select: { vendor: { select: { tracking: { select: { enableBrowserTags: true, enablePageView: true, ga4MeasurementId: true, facebookPixelId: true } } } } },
    });
    return pages.length === 1 ? publicTrackingTags(pages[0]!.vendor.tracking) : {};
  } catch {
    return {};
  }
}
