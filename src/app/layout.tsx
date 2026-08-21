import type { Metadata } from "next";
import "./globals.css";
import { ThemeInit } from "./theme-init";

export const metadata: Metadata = {
  title: "Capitall",
  description: "A budget built for how your family actually spends.",
};

const SUPABASE_ORIGIN = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
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
