import CommerceCheckoutPage from "@/app/checkout/[vendorId]/[productId]/page";
import { CheckoutOverlay } from "@/components/checkout-overlay";

type CheckoutPageProps = {
  params: Promise<{ vendorId: string; productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function InterceptedLiveCheckoutPage(props: CheckoutPageProps) {
  return (
    <CheckoutOverlay>
      <CommerceCheckoutPage {...props} />
    </CheckoutOverlay>
  );
}
