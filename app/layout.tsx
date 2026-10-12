import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Drak a město",
  description: "Týmová hra v terénu.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="cs" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#f6f0e7] text-[#1d1a17]">{children}</body>
    </html>
  );
}
