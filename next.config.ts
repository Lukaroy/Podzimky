import type { NextConfig } from "next";

// Nastavení obrázků, komponentové cache a zpracování Tailwind CSS v Turbopacku.
const nextConfig: NextConfig = {
  images: {
    qualities: [75, 95],
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
