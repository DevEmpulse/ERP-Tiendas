import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
// Extract just the hostname from the Supabase URL for CSP (e.g. "abc.supabase.co")
const supabaseHost = supabaseUrl ? new URL(supabaseUrl).host : "";

const isDev = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  async headers() {
    return [
      // Global security headers
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Force HTTPS for 1 year (applied by browsers once seen once)
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          // Disable sensitive browser APIs not used by this app
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Content Security Policy — restrict resource origins
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Supabase API + Google OAuth
              `connect-src 'self' https://${supabaseHost} https://accounts.google.com https://*.googleapis.com wss://${supabaseHost}`,
              // Scripts: self + Google OAuth iframe + unsafe-eval in dev for React callstacks
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://accounts.google.com`,
              // Styles: self + inline (required by Tailwind)
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Fonts
              "font-src 'self' https://fonts.gstatic.com",
              // Images: self + Google profile pictures + Supabase storage
              `img-src 'self' data: https://lh3.googleusercontent.com https://${supabaseHost}`,
              // Frames: only Google OAuth
              "frame-src https://accounts.google.com",
              // Block <object>, <embed>
              "object-src 'none'",
              // Upgrade insecure requests
              "upgrade-insecure-requests",
            ].join("; "),
          },
        ],
      },
      // Service worker: prevent caching so users always get the latest version
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
