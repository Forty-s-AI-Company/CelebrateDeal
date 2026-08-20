import type { Metadata } from "next";
import { AnnouncementCenter } from "@/components/announcement-center";
import { NavigationProgress } from "@/components/navigation-progress";
import { PersistentLivePlaybackProvider } from "@/components/persistent-live-playback";
import "./globals.css";

export const metadata: Metadata = {
  title: "CelebrateDeal Live Commerce",
  description: "Live-commerce automation MVP for branded video sales funnels.",
};

export default function RootLayout({
  children,
  checkout,
}: {
  children: React.ReactNode;
  checkout: React.ReactNode;
}) {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">
        <NavigationProgress />
        <PersistentLivePlaybackProvider>
          {children}
          {checkout}
        </PersistentLivePlaybackProvider>
        <AnnouncementCenter />
      </body>
    </html>
  );
}
