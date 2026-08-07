import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

function parseHeight(val) {
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

export function generateBinDatabase() {
  const excelPath = path.resolve('assets/Grain_Bin_Specifications.xlsx');
  if (!fs.existsSync(excelPath)) {
    console.error('Excel file not found at:', excelPath);
    return [];
  }

  const workbook = XLSX.readFile(excelPath);
  const allModels = [];

  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'All Bins Summary') continue;

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Find header row (check row 2 first, or search rows 0..9)
    let headerIdx = -1;
    if (rows[2] && Array.isArray(rows[2]) && rows[2].some(c => typeof c === 'string' && c.includes('Standard Model'))) {
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
      const item = {};
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
      const dia = parseFloat(item['Diameter ft']) || parseFloat(item['Diameter m'] ? item['Diameter m'] * 3.28084 : 0) || 30;
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
        fullName: fullName,
        category: isHopper ? 'Hopper Bottom' : 'Flat Bottom',
        series: series,
        isHopper: isHopper,
        stiffened: series.toLowerCase().includes('stiffened'),
        diameterFt: Math.round(dia * 10) / 10,
        rings: rings,
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

  return allModels;
}

// Save JSON database
const data = generateBinDatabase();
console.log(`Successfully parsed ${data.length} bin models from Excel!`);
const outputPath = path.resolve('src/data/excelBinDatabase.json');
fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
console.log(`Saved JSON database to ${outputPath}`);
