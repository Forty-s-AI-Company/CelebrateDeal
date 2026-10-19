"use client";

import { RouteErrorFallback } from "@/components/route-error-fallback";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteErrorFallback title="頁面暫時無法載入" description="可能是網路不穩或服務暫時忙碌，請重新載入，或稍後再回來。" retry={retry} />;
}
