// Next requires a root fallback for the checkout slot while rendering routes
// outside the live viewer. No intercepted route exists here, so admin links
// continue to render the canonical checkout page.
export default function DefaultRootCheckoutSlot() {
  return null;
}
