/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BinSpecModel } from '../types';

/**
 * Browser-side counterpart to scripts/parseExcel.js: that script parses the
 * repo-bundled assets/Grain_Bin_Specifications.xlsx at build/dev time using
 * Node's `fs`, which isn't available in the browser. This mirrors the same
 * column-mapping and normalization logic against a File the user picks in
 * the Bin Specs page, so an uploaded catalogue produces identically-shaped
 * BinSpecModel records. Keep the two in sync if the expected Excel format
 * changes.
 */

function parseHeight(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (s === 'N/A' || s === 'n/a' || s === '-') return null;
  // match feet & inches e.g. 14' 10" or 14'-10" or 14`3.5" or 14’
  const match = s.match(/^(\d+)['`’\s-]+(?:(\d+(?:\.\d+)?)(?:"|”|in)?)?/);
  if (match) {
    const ft = parseInt(match[1], 10);
    const inch = match[2] ? parseFloat(match[2]) : 0;
    return Math.round((ft + inch / 12) * 10) / 10;
  }
  const num = parseFloat(s);
  return isNaN(num) ? null : Math.round(num * 10) / 10;
}

export async function parseBinSpecExcelFile(file: File): Promise<BinSpecModel[]> {
  // Dynamic import: the xlsx parser is only needed for this one action, so
  // it shouldn't be part of the app's normal load.
  const XLSX = await import('xlsx');

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const allModels: any[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'All Bins Summary') continue;

    const sheet = workbook.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Find header row (check row 2 first, or search rows 0..9)
    let headerIdx = -1;
    if (rows[2] && Array.isArray(rows[2]) && rows[2].some((c) => typeof c === 'string' && c.includes('Standard Model'))) {
      headerIdx = 2;
    } else {
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const row = rows[i] || [];
        if (
          Array.isArray(row) &&
          row.some(
            (c) =>
              typeof c === 'string' &&
              (c.includes('Diameter') || c.includes('Standard Model')) &&
              !c.includes('catalog')
          )
        ) {
          headerIdx = i;
          break;
        }
      }
    }
    if (headerIdx === -1) continue;

    const headers = rows[headerIdx].map((h) => String(h || '').trim());
    const dataRows = rows.slice(headerIdx + 1);

    for (const r of dataRows) {
      if (!r || r.length === 0) continue;
      const item: Record<string, any> = {};
      headers.forEach((h, idx) => {
        item[h] = r[idx];
      });

      let stdModel = String(item['Standard Model'] || '').trim();
      let origModel = String(item['Original Model'] || '').trim();
      if (stdModel === 'N/A') stdModel = '';
      if (origModel === 'N/A') origModel = '';

      const effectiveModel = stdModel || origModel;
      if (!effectiveModel) continue;

      const brand = (item['Brand'] || sheetName.split(' ')[0]).trim();
      const series = String(item['Series'] || sheetName).trim();
      const diaMeters = item['Diameter m'] ? Number(item['Diameter m']) * 3.28084 : 0;
      const dia = parseFloat(item['Diameter ft']) || diaMeters || 30;
      const rings = parseInt(item['Rings']) || (effectiveModel.length >= 2 ? parseInt(effectiveModel.slice(-2)) : 6) || 6;
      const bushels =
        parseInt(item['Max Bushels']) ||
        parseInt(item['Bushels 5pct Compaction']) ||
        Math.round(Math.PI * Math.pow(dia / 2, 2) * (rings * 2.66) * 0.8);

      const eaveVal = item['Eave Height'] || item['Fill Height'] || item['Overall Height'] || item['Total Height'] || item['Peak Height'];
      const eaveFt = parseHeight(eaveVal) || Math.round(rings * 2.66 + 3);

      const peakVal = item['Total Height'] || item['Peak Height'] || item['Overall Height'] || item['Fill Height'];
      const peakFt = parseHeight(peakVal) || Math.round(eaveFt + dia * 0.28);

      const isHopper =
        sheetName.toLowerCase().includes('hopper') ||
        series.toLowerCase().includes('hopper') ||
        effectiveModel.toLowerCase().includes('hopper');

      const displayModel = origModel && origModel !== 'N/A' && origModel !== stdModel ? `${stdModel} (${origModel})` : (stdModel || origModel);
      const fullName = `${brand} ${displayModel} - ${series}`;

      const recommendedCablesCount = Math.max(1, Math.floor(dia / 10));
      const recommendedSensorsPerCable = Math.max(3, Math.floor(eaveFt / 6));
      const recommendedCableLengthFt = Math.max(10, Math.round(eaveFt + 2));

      const verifiedCenterCableVal = item['Verified Center Cable Length (ft)'] || item['Verified Center Cable Length'] || '';
      const verifiedRadiusCableVal = item['Verified Radius Cable Length (ft)'] || item['Verified Radius Cable Length'] || '';

      allModels.push({
        id: `excel-${brand}-${effectiveModel}-${allModels.length + 1}`.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        manufacturer: brand,
        modelNumber: stdModel || origModel,
        originalModelNumber: origModel,
        fullName,
        category: isHopper ? 'Hopper Bottom' : 'Flat Bottom',
        series,
        isHopper,
        stiffened: series.toLowerCase().includes('stiffened'),
        diameterFt: Math.round(dia * 10) / 10,
        rings,
        eaveHeightFt: Math.round(eaveFt * 10) / 10,
        totalHeightFt: Math.round(peakFt * 10) / 10,
        floorThicknessFt: 1.5,
        capacityBushels: bushels,
        recommendedCablesCount,
        recommendedSensorsPerCable,
        recommendedCableLengthFt,
        verifiedCenterCableFt: verifiedCenterCableVal ? String(verifiedCenterCableVal).trim() : '',
        verifiedRadiusCableFt: verifiedRadiusCableVal ? String(verifiedRadiusCableVal).trim() : '',
        notes: `Specs from catalog: ${brand} ${series}.`,
      });
    }
  }

  if (allModels.length === 0) {
    throw new Error(
      'No bin models found in this file. Expect one sheet per product line with a header row containing "Standard Model" and "Diameter ft" columns.'
    );
  }

  return allModels as BinSpecModel[];
}
