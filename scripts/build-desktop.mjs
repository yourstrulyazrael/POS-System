// Builds the web app for the desktop installer WITHOUT a built-in store:
// the Supabase URL/key in .env.local are blanked, so a new install shows
// "Connect to your store" and is pointed at its store with a store code.
// Tills that already ran 1.1.6+ saved their store and keep using it.
//
// (`npm run build` / `npm run desktop` still use .env.local; the web version
// on Vercel uses Vercel's own environment variables.)
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  // An empty value takes precedence over .env.local.
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_STORE_NAME: "",
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn("npx", ["--no-install", "next", "build"], { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
