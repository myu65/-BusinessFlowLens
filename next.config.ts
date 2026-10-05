import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["exceljs", "pdfjs-dist", "@napi-rs/canvas", "sharp"],
  distDir: process.env.BFL_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
