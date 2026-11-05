import Script from "next/script";
import { ga4InitScript, metaPixelInitScript, type PublicTrackingTags } from "@/lib/tracking-integration-ids";

/**
 * 平台產生的標準追蹤碼；ID 在 `ga4InitScript`／`metaPixelInitScript` 內再驗證一次。
 * `nonce` 是這次回應的 CSP nonce（F-156）：`next/script` 在瀏覽器端建立 script
 * 元素，只有明確傳入的 nonce 會出現在元素上。
 */
export function PublicTrackingTagScripts({ tags, nonce }: { tags: PublicTrackingTags; nonce?: string }) {
  return <>
    {tags.ga4MeasurementId ? <>
      <Script id="celebratedeal-ga4-loader" strategy="afterInteractive" nonce={nonce} src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tags.ga4MeasurementId)}`} />
      <Script id="celebratedeal-ga4-init" strategy="afterInteractive" nonce={nonce}>{ga4InitScript(tags.ga4MeasurementId)}</Script>
    </> : null}
    {tags.metaPixelId ? <Script id="celebratedeal-meta-pixel" strategy="afterInteractive" nonce={nonce}>{metaPixelInitScript(tags.metaPixelId)}</Script> : null}
  </>;
}
