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
  // unpdf (PDF statement import, bankStatementPdf.ts) is loaded from node_modules as plain Node
  // does: webpack cannot bundle its `import.meta` use cleanly (build warning), and the plain-Node
  // load is what was verified (v2.36.2).
  serverExternalPackages: ["unpdf"],
  // Matches MAX_UPLOAD_MB so a too-large upload is rejected by attachments.ts's own
  // sr-Latn message (assertUploadable), not by a bare Next/platform body-size error —
  // the default (1 MB) was smaller than either, which is the bug this closes (§8.1).
  // F7 (X-Q5): dnevnici su jedno mjesto, „Evidencije”. Stare adrese ostaju u upotrebi (obilježivači, linkovi u
  // porukama) i vode na odgovarajući tab; query parametri (filteri, `str`) Next prosljeđuje na odredište.
  async redirects() {
    return [
      { source: "/aktivnosti", destination: "/evidencije?tab=aktivnosti", permanent: false },
      { source: "/podesavanja/audit", destination: "/evidencije?tab=audit", permanent: false },
      { source: "/podesavanja/poruke", destination: "/evidencije?tab=poruke", permanent: false },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: `${MAX_UPLOAD_MB}mb`,
    },
  },
};

export default nextConfig;
