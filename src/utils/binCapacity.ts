/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BinAsset } from '../types';

/**
 * Estimated storage capacity in bushels for a grain bin, using the standard
 * cylinder + cone-frustum approximation (0.80356 bu/ft^3 for wheat-density
 * grain). Hopper-bottom bins add their cone volume instead of subtracting a
 * flat floor thickness. This is the single source of truth for the formula
 * so the Dashboard, Cable Estimator, and PDF report can never disagree with
 * each other on a bin's capacity.
 */
export function computeBinCapacityBushels(bin: BinAsset): number {
  const D = parseFloat(bin.diameter) || 0;
  const H = parseFloat(bin.totalHeight) || 0;
  const E = parseFloat(bin.eaveHeight) || 0;
  const F = parseFloat(bin.floorThick) || 0;
  const isHopper = !!bin.isHopper;
  const C = isHopper ? parseFloat(bin.hopperConeHeight || '0') || 0 : 0;

  return Math.round(
    isHopper
      ? Math.PI * Math.pow(D / 2, 2) * (E + (H - E) / 3 + C / 3) * 0.80356
      : Math.PI * Math.pow(D / 2, 2) * (Math.max(0, E - F) + (H - E) / 3) * 0.80356
  );
}
