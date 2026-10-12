import type { NextConfig } from "next";

// The app is packaged as a desktop app (Electron), so it builds to a fully
// static site in out/ with no Next.js server. Privileged work happens in
// Supabase (RLS, database functions and the pos-admin Edge Function).
const nextConfig: NextConfig = {
  output: "export",
  // Each page becomes <route>/index.html, which the desktop shell serves directly.
  trailingSlash: true,
  // No image optimization server in a static export.
  images: { unoptimized: true },
};

export default nextConfig;
