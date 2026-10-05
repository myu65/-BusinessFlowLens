import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.BFL_APP_RUNTIME === "1" ? "standalone" : undefined,
  outputFileTracingIncludes: process.env.BFL_APP_RUNTIME === "1" ? { "/*": ["./node_modules/snowflake-sdk/**/*", "./node_modules/pdfjs-dist/**/*", "./node_modules/@napi-rs/canvas*/**/*", "./assets/pdf-fonts/**/*"] } : undefined,
  serverExternalPackages: ["exceljs", "pdfjs-dist", "@napi-rs/canvas", "sharp", "snowflake-sdk"],
  distDir: process.env.BFL_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
