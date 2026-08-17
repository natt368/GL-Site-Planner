/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Kept in its own module, separate from pdfGenerator.ts: this pure function
// is imported by several always-loaded views (Site Planner, Cable Estimator,
// Bin Specs), and pdfGenerator.ts pulls in jsPDF/jspdf-autotable/html2canvas
// (~250KB). Bundlers split at module boundaries, so if this lived alongside
// those heavy imports, every view that just needs a cable-length suggestion
// would drag the PDF renderer into the main bundle too.
export function getCableRecommendation(diameterStr: string) {
  const d = parseFloat(diameterStr) || 0;
  if (d < 24) {
    return { center: 1, radius: 0 };
  } else if (d <= 35) {
    return { center: 0, radius: 3 };
  } else if (d <= 41) {
    return { center: 1, radius: 3 };
  } else {
    return { center: 1, radius: 4 };
  }
}
