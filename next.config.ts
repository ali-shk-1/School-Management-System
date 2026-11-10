import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // bcrypt (and any other native Node addon) must never be bundled by
  // Turbopack — bundling renames/hashes it (e.g. "bcrypt-<hash>"), which
  // then fails to resolve at runtime because the hashed name doesn't
  // exist in node_modules, even when node_modules/bcrypt itself is
  // present and correctly built. Declaring it here tells Next to leave
  // it as a plain `require("bcrypt")` and to copy the real bcrypt
  // package (including its native .node binary) into the standalone
  // output's node_modules as-is.
  serverExternalPackages: ["bcrypt"],
  // Gzip/Brotli-compress all responses (HTML, JSON, JS chunks) — cuts
  // transfer size substantially on slower mobile connections.
  compress: true,
  // Drop the X-Powered-By response header — no functional effect, just
  // one less header to send on every single request.
  poweredByHeader: false,
  // React StrictMode surfaces unsafe effects/renders in dev so they get
  // fixed before they cause perceived jank in production.
  reactStrictMode: true,

  // photo_url values are stored/returned as bare /uploads/... (see
  // lib/uploads.ts savePhotoFile), but Next.js API routes can't serve
  // files the way express.static did — the actual file-serving logic
  // lives at app/api/uploads/[...path]/route.ts. This rewrite makes
  // /uploads/... requests resolve to that route transparently, so
  // <img src={photo_url}> keeps working without changing every
  // reference to /api/uploads/... throughout the app.
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: "/api/uploads/:path*",
      },
    ];
  },
};

export default nextConfig;