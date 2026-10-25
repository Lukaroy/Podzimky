import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./admin-hud.css";

const hudDisplay = Space_Grotesk({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hud-display",
  display: "swap",
});
const hudMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  variable: "--font-hud-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Podzimky 2026",
  description: "Podzimky 2026",
};

// Vytvoří společný HTML obal a metadata pro všechny stránky aplikace.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="cs" className={`h-full antialiased ${hudDisplay.variable} ${hudMono.variable}`}>
      <body className="min-h-full flex flex-col bg-[#f6f0e7] text-[#1d1a17]">{children}</body>
    </html>
  );
}
