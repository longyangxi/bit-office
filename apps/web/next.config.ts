import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import path from "path";
import { readFileSync } from "fs";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  navigateFallbackDenylist: [/^\/preview-static/, /^\/preview-app/],
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        // Preview proxy paths — never cache, always hit the gateway proxy
        urlPattern: /^\/(preview-static|preview-app)(\/.*)?$/,
        handler: "NetworkOnly",
      },
    ],
  },
});

const isDev = process.env.NODE_ENV === "development";

/** Monorepo root (…/bit-office) — same `version` as shipped gateway bundles this `out/` */
const repoRoot = path.resolve(__dirname, "../..");
let appVersion = "0.0.0";
try {
  const raw = readFileSync(path.join(repoRoot, "package.json"), "utf8");
  appVersion = (JSON.parse(raw) as { version?: string }).version ?? appVersion;
} catch {
  /* keep default */
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_BUILD_TIME: new Date().toISOString(),
  },
  devIndicators: false,
  reactStrictMode: true,
  transpilePackages: ["@office/shared"],
  output: isDev ? undefined : "export",
  ...(isDev && {
    headers: async () => [
      {
        source: "/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ],
  }),
};

export default withPWA(nextConfig);
