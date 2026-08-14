import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CelebrateDeal Live Commerce",
  description: "Live-commerce automation MVP for branded video sales funnels.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
