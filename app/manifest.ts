import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FundFlow",
    short_name: "FundFlow",
    description: "Private personal finance planning cockpit.",
    start_url: "/dashboard",
    display: "standalone",
    // Both track the design tokens in app/globals.css: --background and
    // --accent. They were left on a pre-retheme teal after the V0 retheme,
    // which put the wrong brand colour in the installed app's chrome.
    background_color: "#f6f5f3",
    theme_color: "#ff6b2e",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Full-bleed variant: launchers that crop to a circle would clip the
      // rounded-square icons above.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
