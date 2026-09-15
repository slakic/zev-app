import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // assets/fonts/** is read via a raw fs path (src/server/pdf/fonts.ts), not an
  // import, so Next's output file tracing can't discover it on its own — without
  // this, a platform that packages only traced files ships without the fonts and
  // PDF generation fails at runtime instead of at build time. See
  // Plans/deployment-portability-plan.md §4.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**"],
  },
};

export default nextConfig;
