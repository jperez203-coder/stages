import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts are self-hosted from ./fonts (latin subset, downloaded from Google
// Fonts 2026-09-25) instead of next/font/google. next/font/google fetches
// from Google at build time and breaks when Google returns extensionless
// font URLs (vercel/next.js#99114, unfixed in 16.2.x) — local files make
// dev and Vercel builds independent of that fetch.
const plusJakartaSans = localFont({
  variable: "--font-plus-jakarta-sans",
  src: "./fonts/PlusJakartaSans-Variable.woff2",
  weight: "400 800",
  display: "swap",
});

// Scoped to the Home greeting + tab row only (Figma V2) — everything else
// in the app stays Plus Jakarta Sans. Exposed as the `font-poppins`
// Tailwind utility via the --font-poppins theme token in globals.css.
const poppins = localFont({
  variable: "--font-poppins-raw",
  src: [
    { path: "./fonts/Poppins-400.woff2", weight: "400" },
    { path: "./fonts/Poppins-500.woff2", weight: "500" },
    { path: "./fonts/Poppins-600.woff2", weight: "600" },
    { path: "./fonts/Poppins-700.woff2", weight: "700" },
  ],
  display: "swap",
});

// Scoped to the sidebar + Docs pages (Notion/ClickUp-style UI type).
// Exposed as the `font-inter` Tailwind utility via --font-inter in globals.css.
const inter = localFont({
  variable: "--font-inter-raw",
  src: "./fonts/Inter-Variable.woff2",
  weight: "400 700",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Stages",
  description: "The operating system for client services businesses.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${poppins.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
