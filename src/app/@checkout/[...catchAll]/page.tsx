// Client-side navigation keeps parallel-route slots active. Matching all
// non-checkout destinations with null ensures the checkout overlay can open
// and close without replacing the underlying live page.
export default function CatchAllCheckoutSlot() {
  return null;
}
