import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  { ignores: [".next/**", "out/**", "dist-desktop/**", "supabase/functions/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // The Electron main process is CommonJS.
  { files: ["electron/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];

export default eslintConfig;
