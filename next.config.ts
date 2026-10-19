import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// Shown in the app (footer, sign-in screen) so everyone can tell which version a till runs.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

// The app is packaged as a desktop app (Electron), so it builds to a fully
// static site in out/ with no Next.js server. Privileged work happens in
// Supabase (RLS, database functions and the pos-admin Edge Function).
const nextConfig: NextConfig = {
  output: "export",
  // Each page becomes <route>/index.html, which the desktop shell serves directly.
  trailingSlash: true,
  // No image optimization server in a static export.
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
