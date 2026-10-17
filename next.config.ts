import type { NextConfig } from "next";

// Security headers, set here rather than in the proxy so they reach EVERY response.
//
// They used to be added by src/proxy.ts, whose matcher skips _next/static and which only
// called its header helper on some branches (public pages and cross-origin rejections),
// so most pages, every API response and every static file went out without them.
// next.config headers are applied by the server itself, before routing, so nothing
// can forget them.

const isDev = process.env.NODE_ENV === "development";

// Content-Security-Policy.
//
// What this app actually loads, and why each directive is what it is:
//  - Scripts: only our own bundles from /_next/static, plus INLINE scripts that Next
//    (the RSC flight payload, `self.__next_f.push(...)`) and next-themes (the
//    no-flash theme script) write into the HTML. A nonce would let us drop
//    'unsafe-inline', but Next can only stamp nonces into dynamically rendered pages:
//    nearly every page here is prerendered (○ in the build output), and switching the
//    whole app to per-request rendering is a bigger change than this header. So script
//    sources are limited to this origin, which still stops a page loading script from
//    anywhere else. (It does not stop an injected inline <script>; React's escaping is
//    what protects against that.)
//    'unsafe-eval' is dev-only: React uses eval there to rebuild server error stacks.
//  - Styles: recharts, sonner and base-ui set inline style attributes, and Next inlines
//    critical CSS, so 'unsafe-inline' is required. Inline CSS cannot run script.
//  - Fonts: next/font self-hosts IBM Plex Sans Arabic under /_next/static/media at
//    build time; nothing is fetched from Google at runtime.
//  - connect-src 'self': every fetch is to our own /api. Web Push doesn't need an entry:
//    the browser talks to the push service itself, not the page. Same-origin covers the
//    dev server's HMR websocket too.
//  - worker-src / manifest-src: the PWA service worker (/sw.js) and /manifest.json.
//  - frame-ancestors 'none' replaces X-Frame-Options (kept below for old browsers).
//  - The Google Maps links on the off-site report are plain navigations, which CSP
//    doesn't restrict.
//
// No upgrade-insecure-requests: HSTS already covers production, and it would break the
// e2e suite and `next start` checks, which run in production mode over plain http.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Geolocation stays available to our own pages because check-in records where the
// employee is. Everything else the app never uses is switched off, so an injected
// script or a framed page can't ask for it either.
const permissionsPolicy = [
  "geolocation=(self)",
  "camera=()",
  "microphone=()",
  "display-capture=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "browsing-topics=()",
].join(", ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Permissions-Policy", value: permissionsPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Production only: browsers ignore HSTS over plain http anyway, and sending it from a
  // dev server on localhost can pin localhost to https in the developer's browser. No
  // includeSubDomains/preload: this app may live on a subdomain of a company domain,
  // and that would force HTTPS on hosts it doesn't own.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000" }]),
];

const nextConfig: NextConfig = {
  // Don't advertise the framework (and so which advisories apply) on every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
