import type { Metadata } from "next";
import "./globals.css";
import { getAuthContext } from "@/server/auth/session";

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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // „Veći tekst i dugmad” (Plans/pristupacni-prikaz-plan.md, D-P4 A): po sačuvanoj postavci za
  // prijavljenog korisnika, na svim njegovim rutama (i /uzivo, /onboarding). Bez prijave (prijava,
  // zaboravljena lozinka, reset, glasanje putem linka) uvijek veći: jedna kartica, ništa ne gubi.
  const ctx = await getAuthContext();
  const textLarge = ctx ? ctx.uiTextLarge : true;
  return (
    <html lang="sr-Latn" data-text={textLarge ? "large" : undefined}>
      <body className="antialiased bg-canvas text-ink">{children}</body>
    </html>
  );
}
