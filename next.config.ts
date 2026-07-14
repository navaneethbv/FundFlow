import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its standard-font metrics (Helvetica.afm and friends) off disk
  // with fs.readFileSync at render time. Bundling it rewrites those reads to a
  // /ROOT/node_modules path that does not exist in the deployed function, so the
  // weekly report failed with ENOENT on every send. Keep pdfkit external and
  // trace its data/ directory into both routes that render a PDF.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/cron/weekly-report": ["./node_modules/pdfkit/js/data/**"],
    "/api/export/report": ["./node_modules/pdfkit/js/data/**"],
  },
};

export default nextConfig;
