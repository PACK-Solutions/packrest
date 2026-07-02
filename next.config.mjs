import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  // Allow LAN devices (phones, other machines) to reach the dev server's
  // HMR/websocket resources without the cross-origin block.
  allowedDevOrigins: ["192.168.1.15", "192.168.1.*"],
};

export default config;
