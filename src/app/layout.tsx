import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ThemeInit } from "./theme-init";

export const metadata: Metadata = {
  title: "Capitall",
  description: "A budget built for how your family actually spends.",
};

// Geist (Victor's pick over Inter, 2026-10-08), self-hosted by next/font (no
// request to Google at runtime). Exposed as a CSS variable so globals.css can
// put it at the front of --font-sans.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Warm the TLS + DNS handshake to Supabase in parallel with the
            initial HTML download, so the first query on the page doesn't
            pay for the connection setup. */}
        {SUPABASE_ORIGIN ? (
          <>
            <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={SUPABASE_ORIGIN} />
          </>
        ) : null}
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
