import type { Metadata } from "next";
import { Silkscreen, Sometype_Mono, Archivo } from "next/font/google";
import Link from "next/link";
import { NavLinks } from "@/components/NavLinks";
import { baseUrl } from "@/lib/site";
import "./globals.css";

// Silkscreen at 400 only: that is the weight rarefriends.com and our PNG cards use.
const silk = Silkscreen({ weight: ["400"], subsets: ["latin"], variable: "--f-px", display: "swap" });
const mono = Sometype_Mono({ subsets: ["latin"], variable: "--f-mono", display: "swap" });
const sans = Archivo({ subsets: ["latin"], variable: "--f-sans", display: "swap" });

const DESCRIPTION = "Shareable stat cards for your Rare Friends. Paste a wallet, no connect needed.";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: "Rare Friends Cards",
  description: DESCRIPTION,
  openGraph: { title: "Rare Friends Cards", description: DESCRIPTION, siteName: "Rare Friends Cards", type: "website", url: "/" },
  twitter: { card: "summary_large_image", title: "Rare Friends Cards", description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${silk.variable} ${mono.variable} ${sans.variable}`}>
      <body>
        <a href="#main" className="skip">skip to content</a>
        <nav className="topbar">
          <Link href="/" className="brand">
            <svg width="22" height="22" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden><path fill="currentColor" d="M0 0h8v1h-8zM0 1h1v1h-1zM3 1h2v1h-2zM7 1h1v1h-1zM0 2h2v1h-2zM6 2h2v1h-2zM0 3h1v1h-1zM2 3h1v1h-1zM5 3h1v1h-1zM7 3h1v1h-1zM0 4h1v1h-1zM7 4h1v1h-1zM0 5h1v1h-1zM3 5h2v1h-2zM7 5h1v1h-1zM0 6h2v1h-2zM6 6h2v1h-2zM0 7h8v1h-8z" /></svg>
            <span className="px">RARE FRIENDS CARDS</span>
          </Link>
          <NavLinks />
        </nav>
        {children}
      </body>
    </html>
  );
}
