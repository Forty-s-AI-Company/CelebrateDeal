export type AnalyticsFunnelCounts = {
  views: number;
  productClicks: number;
  ctaClicks: number;
  submissions: number;
};

export type AnalyticsFunnelStep = {
  key: keyof AnalyticsFunnelCounts;
  label: string;
  count: number;
  percentage: number;
};

function percentageOfViews(count: number, views: number) {
  if (views <= 0) return 0;
  return Math.round((count / views) * 1000) / 10;
}

/**
 * Builds the live analytics funnel using views as the shared conversion base.
 * A live with no views intentionally reports stable 0% ratios for every step.
 */
export function calculateAnalyticsFunnel({
  views,
  productClicks,
  ctaClicks,
  submissions,
}: AnalyticsFunnelCounts): AnalyticsFunnelStep[] {
  return [
    { key: "views", label: "觀看", count: views, percentage: percentageOfViews(views, views) },
    { key: "productClicks", label: "商品點擊", count: productClicks, percentage: percentageOfViews(productClicks, views) },
    { key: "ctaClicks", label: "CTA 點擊", count: ctaClicks, percentage: percentageOfViews(ctaClicks, views) },
    { key: "submissions", label: "名單", count: submissions, percentage: percentageOfViews(submissions, views) },
  ];
}
