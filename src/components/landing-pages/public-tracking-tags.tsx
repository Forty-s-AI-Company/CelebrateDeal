import Script from "next/script";
import { ga4InitScript, metaPixelInitScript, type PublicTrackingTags } from "@/lib/tracking-integration-ids";

/** 平台產生的標準追蹤碼；ID 在 `ga4InitScript`／`metaPixelInitScript` 內再驗證一次。 */
export function PublicTrackingTagScripts({ tags }: { tags: PublicTrackingTags }) {
  return <>
    {tags.ga4MeasurementId ? <>
      <Script id="celebratedeal-ga4-loader" strategy="afterInteractive" src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tags.ga4MeasurementId)}`} />
      <Script id="celebratedeal-ga4-init" strategy="afterInteractive">{ga4InitScript(tags.ga4MeasurementId)}</Script>
    </> : null}
    {tags.metaPixelId ? <Script id="celebratedeal-meta-pixel" strategy="afterInteractive">{metaPixelInitScript(tags.metaPixelId)}</Script> : null}
  </>;
}
