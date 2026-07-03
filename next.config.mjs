import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { version } = createRequire(import.meta.url)("./package.json");

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Static export: the frontend is bundled into `out/` and served by the Tauri
  // webview. There is no Node server at runtime — all former API routes now run
  // client-side through Tauri plugins.
  output: "export",
  // Expose the app version to the browser/prerender path (getAppVersion falls
  // back to this when the Tauri runtime API is unavailable).
  env: { NEXT_PUBLIC_APP_VERSION: version },
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  // Allow LAN devices to reach the dev server's HMR resources (dev only).
  allowedDevOrigins: ["192.168.1.15", "192.168.1.*"],
};

export default config;
