import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    staleTimes: { dynamic: 0 },
  },
  async rewrites() {
    return [
      // Claude Mobile verbindet sich auf /mcp und /sse (ohne /api/ Prefix)
      { source: "/mcp", destination: "/api/mcp" },
      { source: "/sse", destination: "/api/sse" },
    ];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/_next/static/(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
