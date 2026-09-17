import type { FunnelNodeType } from "@/lib/funnel-page-document";
import type { FunnelCommerceBinding, FunnelCommerceView } from "@/lib/funnel-commerce";

const money = (priceCents: number, currency: string) => new Intl.NumberFormat("zh-TW", { style: "currency", currency }).format(priceCents / 100);
const buttonClass = "inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white";

/** Commerce never trusts node props, responsive overrides or arbitrary node actions. */
export function FunnelCommerceElement({ type, binding, commerce, interactive = false }: {
  type: FunnelNodeType; binding?: FunnelCommerceBinding; commerce?: FunnelCommerceView; interactive?: boolean;
}) {
  const product = commerce?.product;
  if (!binding || !product || product.id !== binding.productId) return <div data-funnel-capability={type} role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">尚未連結商品與付款方式。請在訂單步驟的「商品與結帳」選擇有效商品，再儲存並發布。</div>;
  const checkoutLink = (label: string) => interactive && commerce.checkoutPath?.startsWith("/lp/") && !commerce.checkoutPath.includes("\\")
    ? <a href={commerce.checkoutPath} className={buttonClass}>{label}</a>
    : <button type="button" disabled className={`${buttonClass} opacity-60`}>{label}（預覽不收款）</button>;
  switch (type) {
    case "offer_price": return <div><p className="text-sm text-slate-600">{product.name}</p><strong className="text-2xl">{money(product.priceCents, product.currency)}</strong></div>;
    case "payment_button": return checkoutLink("前往安全結帳");
    case "two_step_order_form": return <div className="grid gap-3 rounded-xl border p-4"><ol className="list-inside list-decimal text-sm"><li>填寫聯絡資料</li><li>確認訂單與付款</li></ol>{binding.formMode === "two_step" ? checkoutLink("開始兩步驟結帳") : <p role="status">請在商品與結帳設定將版面切換為「兩步驟」。</p>}</div>;
    case "payment_method": return <p>付款方式會在金流商安全頁面提供。CelebrateDeal 不在此收集卡號；付款設定未就緒時不會建立付款。</p>;
    case "physical_product": return product.fulfillmentType === "physical" ? <p>{product.name}：結帳時填寫收件人與配送地址。</p> : <p role="status">目前選擇的是非實體商品，不需要配送地址。</p>;
    case "customer_type": return <p>結帳時可選擇個人、公司或捐贈發票資料。</p>;
    case "agreement": return <p>{binding.agreement?.label ?? "請於結帳頁閱讀並同意使用條款、隱私通知與退款政策。"}{binding.agreement ? "（結帳時須勾選同意）" : ""}</p>;
    case "order_bump": return commerce.orderBump && commerce.orderBump.id === binding.orderBumpProductId ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-4"><strong>可選加購：{commerce.orderBump.name}</strong><p>{money(commerce.orderBump.priceCents, commerce.orderBump.currency)}，於結帳頁選擇。</p></div> : <p role="status">尚未設定加購商品，請在商品與結帳選擇同幣別商品。</p>;
    case "coupon": return <div data-funnel-capability="coupon" role="status">目前支援既有已領取優惠券，由結帳伺服器確認資格並折抵；尚未提供手動輸入優惠碼。</div>;
    case "shipping_fees": return <div data-funnel-capability="shipping_fees" role="status">{product.fulfillmentType === "physical" ? "目前結帳未提供獨立運費規則，不會額外加收運費。請確認商品售價已涵蓋配送成本。" : "非實體商品不需配送，無額外運費。"}</div>;
    default: return <p role="status">此付款元件尚未支援目前的商品類型。</p>;
  }
}
