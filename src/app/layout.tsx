import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CelebrateDeal Live Commerce",
  description: "Live-commerce automation MVP for branded video sales funnels.",
};

export default function RootLayout(props: LayoutProps<"/">) {
  const { children } = props;
  // Local generated types can lag behind a newly introduced parallel slot.
  const checkout = (props as LayoutProps<"/"> & { checkout?: React.ReactNode }).checkout;
  return (
    <html lang="zh-Hant" className="h-full">
      <body className="min-h-full flex flex-col">
        {children}
        {checkout}
      </body>
    </html>
  );
}
