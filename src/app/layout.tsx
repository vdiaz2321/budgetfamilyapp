import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { ThemeInit } from "./theme-init";

// Montserrat is the closest free match to EveryDollar's Gotham.
const appFont = Montserrat({
  variable: "--font-app",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Capitall",
  description: "A budget built for how your family actually spends.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${appFont.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
