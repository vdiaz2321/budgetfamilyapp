import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the dev-mode route indicator badge — it floats over the bottom-right
  // of every page. Compile/runtime errors still surface.
  devIndicators: false,
};

export default nextConfig;
