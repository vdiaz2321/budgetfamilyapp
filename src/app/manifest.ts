import type { MetadataRoute } from "next";

// Lets the phone install the app to the home screen and open it full-screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Capitall",
    short_name: "Capitall",
    description: "A budget built for how your family actually spends.",
    start_url: "/budget",
    display: "standalone",
    background_color: "#faf8f4",
    theme_color: "#faf8f4",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
