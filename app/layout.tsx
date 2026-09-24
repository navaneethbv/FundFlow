import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { buildPaletteCss, DARK_PALETTES, LIGHT_PALETTES } from "@/lib/themes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "FundFlow",
    template: "%s — FundFlow",
  },
  description: "Secure personal finance insights powered by Plaid.",
};

// Palette ids are embedded as data, and a stored value is applied only if it
// is one of them, so localStorage can never inject an arbitrary attribute.
const paletteIds = JSON.stringify({
  light: LIGHT_PALETTES.map((palette) => palette.id),
  dark: DARK_PALETTES.map((palette) => palette.id),
});

const PALETTE_CSS = buildPaletteCss();

const themeScript = `
(() => {
  try {
    const stored = localStorage.getItem("fundflow-theme");
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    const theme = stored === "light" || stored === "dark" ? stored : system;
    document.documentElement.dataset.theme = theme;
    const ids = ${paletteIds};
    for (const mode of ["light", "dark"]) {
      const palette = localStorage.getItem("fundflow-palette-" + mode);
      if (palette && ids[mode].includes(palette)) {
        document.documentElement.setAttribute("data-palette-" + mode, palette);
      }
    }
    // Restore privacy mode pre-paint too (F-6): without this, amounts flash
    // unblurred on every reload for users who left blur on.
    if (localStorage.getItem("fundflow-privacy") === "blur") {
      document.documentElement.dataset.privacy = "blur";
    }
  } catch {}
})();
`;

const serviceWorkerScript = `
(() => {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        {/* Palette overrides, generated from lib/themes.ts (the one source of
            truth). Static, server-built CSS with no user input. */}
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: PALETTE_CSS }} />
        {/*
          Plaid Link is NOT loaded here. `react-plaid-link` injects it on demand
          from the two components that need it, which `strict-dynamic` already
          permits. Loading it globally would hand cdn.plaid.com a request on
          every page view, including signed-out ones.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: serviceWorkerScript }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:min-h-11 focus:rounded-field focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-foreground"
        >
          Skip to content
        </a>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
