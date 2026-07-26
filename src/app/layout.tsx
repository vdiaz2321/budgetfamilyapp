import type { Metadata } from "next";
import "./globals.css";
import { ThemeInit } from "./theme-init";

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
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
