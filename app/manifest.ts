import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FundFlow",
    short_name: "FundFlow",
    description: "Private personal finance planning cockpit.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f766e",
    icons: [
      {
        src: "/next.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/next.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
    ],
  };
}
