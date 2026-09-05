import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZEV upravnik",
  description: "Upravljanje zajednicom etažnih vlasnika — Republika Srpska",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sr-Latn">
      <body className="antialiased bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
