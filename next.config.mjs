import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = ["./assets/fonts/*.ttf"];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // Report-only first; promote to Content-Security-Policy after a clean day. Next needs inline scripts for hydration.
  {
    key: "Content-Security-Policy-Report-Only",
    value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://rarefriends.com https://*.rarefriends.com; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Serve blocking (non-streamed) metadata to every user agent: Farcaster, Bluesky and other scrapers missing from
  // Next's built-in bot list would otherwise get a streamed shell whose og tags can land in the body under load.
  htmlLimitedBots: /.*/,
  // Pin the tracing root so a stray lockfile in a parent folder can't change what gets bundled.
  outputFileTracingRoot: here,
  // Make sure the bundled TTFs ship inside every function that renders a card.
  outputFileTracingIncludes: {
    "/card/[address]": FONTS,
    "/card/[address]/[id]": FONTS,
    "/card/[address]/og": FONTS,
    "/card/[address]/[id]/og": FONTS,
    "/opengraph-image": FONTS,
    "/twitter-image": FONTS,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
export default nextConfig;
