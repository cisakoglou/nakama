import type { MetadataRoute } from "next";

// Installable app shell; required for Web Push on iPhone (Add to Home Screen).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nakama",
    short_name: "Nakama",
    description: "Your training companion, grounded in your workouts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#18120f",
    theme_color: "#18120f",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
