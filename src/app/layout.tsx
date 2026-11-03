import type { Metadata } from "next";
import { AnnouncementCenter } from "@/components/announcement-center";
import { CspNonceProvider } from "@/components/csp-nonce";
import { NavigationProgress } from "@/components/navigation-progress";
import { PersistentLivePlaybackProvider } from "@/components/persistent-live-playback";
import { requestCspNonce } from "@/lib/csp-nonce-server";
import "./globals.css";

export const metadata: Metadata = {
  title: "CelebrateDeal Live Commerce",
  description: "Live-commerce automation MVP for branded video sales funnels.",
};

/**
 * Reading the request nonce makes every page dynamic, which the nonce CSP
 * requires (F-156): a prerendered page would carry scripts without the
 * per-request nonce and break once the policy is enforced.
 */
export default async function RootLayout({
  children,
  checkout,
}: {
  children: React.ReactNode;
  checkout: React.ReactNode;
}) {
  const nonce = await requestCspNonce();
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">
        <CspNonceProvider nonce={nonce}>
          <NavigationProgress />
          <PersistentLivePlaybackProvider>
            {children}
            {checkout}
          </PersistentLivePlaybackProvider>
          <AnnouncementCenter />
        </CspNonceProvider>
      </body>
    </html>
  );
}
