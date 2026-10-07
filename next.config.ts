import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the native image module outside the bundle so the serverless
  // function ships its Linux libvips files instead of a bundled copy that
  // cannot find them at runtime.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
