import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Static export: the frontend is bundled into `out/` and served by the Tauri
  // webview. There is no Node server at runtime — all former API routes now run
  // client-side through Tauri plugins.
  output: "export",
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  // Allow LAN devices to reach the dev server's HMR resources (dev only).
  allowedDevOrigins: ["192.168.1.15", "192.168.1.*"],
};

export default config;
