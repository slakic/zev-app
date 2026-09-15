import type { NextConfig } from "next";

// Kept in sync with src/lib/env.ts's own MAX_UPLOAD_MB default (4) but read directly here,
// not via getEnv(): next.config.ts is evaluated by the Next CLI itself at
// `next build`/`next start` startup, outside the app's own module graph and before real env
// vars are guaranteed to be present (Dockerfile builds the image with a placeholder
// DATABASE_URL and no APP_URL) — calling getEnv() here would trip its
// APP_URL-required-in-production check during the build itself (§13 risk 4).
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB);
const MAX_UPLOAD_MB = Number.isFinite(maxUploadMb) && maxUploadMb > 0 ? maxUploadMb : 4;

const nextConfig: NextConfig = {
  // assets/fonts/** is read via a raw fs path (src/server/pdf/fonts.ts), not an
  // import, so Next's output file tracing can't discover it on its own — without
  // this, a platform that packages only traced files ships without the fonts and
  // PDF generation fails at runtime instead of at build time. See
  // Plans/deployment-portability-plan.md §4.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**"],
  },
  // Matches MAX_UPLOAD_MB so a too-large upload is rejected by attachments.ts's own
  // sr-Latn message (assertUploadable), not by a bare Next/platform body-size error —
  // the default (1 MB) was smaller than either, which is the bug this closes (§8.1).
  experimental: {
    serverActions: {
      bodySizeLimit: `${MAX_UPLOAD_MB}mb`,
    },
  },
};

export default nextConfig;
