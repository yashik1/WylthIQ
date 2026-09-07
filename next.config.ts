import type { NextConfig } from "next";

/**
 * Security response headers.
 *
 * Everything the browser loads here is same-origin: next/font self-hosts the
 * faces, there are no `remotePatterns` so no external images, and the only
 * outbound calls a page makes are to this app's own /api routes — the
 * providers are all reached server-side. That makes a tight policy realistic
 * rather than aspirational.
 *
 * The Content-Security-Policy is deliberately split in two, which is the part
 * worth explaining.
 *
 * `ENFORCED` carries only the directives that cannot break a working page:
 * nothing may frame this app, no plugins, no injected <base> tag, and forms
 * may only post back here. Those close real attacks — clickjacking, base-tag
 * hijacking, form exfiltration — and no legitimate page behaviour depends on
 * them, so they take effect immediately.
 *
 * `REPORTED` adds the resource directives — where scripts, styles and
 * connections may come from — and rides in Report-Only. Not timidity: Next's
 * App Router injects its own inline bootstrap scripts whose content differs
 * per page, so a strict `script-src` without per-request nonces would block
 * hydration and leave a blank site. Report-Only means violations are
 * observable before anything is enforced, which is the order the hardening
 * spec asks for. Enforcing it needs nonces threaded through middleware, and
 * that is a deliberate follow-up rather than something to guess at here.
 */
const CSP_ENFORCED = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Enforced rather than reported: browsers ignore this directive entirely in
  // a report-only policy and say so in the console, so listing it there was
  // decoration. It belongs with the directives that actually take effect.
  "upgrade-insecure-requests",
].join("; ");

const CSP_REPORTED = [
  "default-src 'self'",
  // 'unsafe-inline' is what Next's per-page bootstrap needs without nonces;
  // 'unsafe-eval' is deliberately absent and should stay that way.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind emits a stylesheet, but Next inlines critical CSS and the theme
  // toggle writes a style attribute, so inline styles are genuinely required.
  "style-src 'self' 'unsafe-inline'",
  // data: for the inline SVG marks; blob: for canvas-rendered chart exports.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  {
    /*
      Two years, subdomains included. Both wylthiq.com and www.wylthiq.com
      terminate TLS at Railway, so there is no subdomain left on plain HTTP to
      strand.

      `preload` is deliberately omitted. It is a one-way door: browsers ship
      the list baked in, removal takes months, and it would apply to every
      future subdomain including one somebody stands up on HTTP by accident.
      Worth adding once the domain has been stable for a while — not on the
      day the DNS was finished.
    */
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Redundant beside frame-ancestors above, and kept for the browsers and
  // scanners that only look for this one.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // Nothing here uses any of these, so they are switched off rather than
    // left available to anything that ends up on the page.
    key: "Permissions-Policy",
    value: [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "usb=()",
      "magnetometer=()",
      "gyroscope=()",
      "accelerometer=()",
      "browsing-topics=()",
    ].join(", "),
  },
  { key: "Content-Security-Policy", value: CSP_ENFORCED },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORTED },
  // Off by default in modern browsers and actively harmful in old ones, but
  // scanners still flag its absence.
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // Removes the framework version from every response. It tells an attacker
  // which advisories to try and tells a legitimate client nothing.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
