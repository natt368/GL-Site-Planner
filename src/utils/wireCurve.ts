/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { WireConnection } from '../types';

/**
 * Computes the quadratic-curve control point and resulting curve midpoint
 * for a wire between two endpoints. If the wire has a user-set bend point
 * (wire.bendX/bendY), the control point is derived so the curve passes
 * exactly through that point - the endpoints stay put, and the curve bends
 * through wherever the person dragged the midpoint. Otherwise falls back to
 * the automatic perpendicular offset used to avoid overlapping bins.
 *
 * Shared between the Site Planner canvas and the PDF generator so a wire
 * renders identically (including any manual bend) in both places.
 */
export function getWireCurve(x1: number, y1: number, x2: number, y2: number, wire: Pick<WireConnection, 'bendX' | 'bendY'>) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  let ctrlX: number;
  let ctrlY: number;

  if (wire.bendX !== undefined && wire.bendY !== undefined) {
    // Reverse the quadratic-bezier midpoint formula (P0 + 2*P1 + P2) / 4
    // so the curve's t=0.5 point lands exactly on the dragged bend point.
    ctrlX = 2 * wire.bendX - midX;
    ctrlY = 2 * wire.bendY - midY;
  } else {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.max(30, len * 0.25);
    const px = -dy / (len || 1);
    const py = dx / (len || 1);
    ctrlX = midX + px * offset;
    ctrlY = midY + py * offset;
  }

  const curveMidX = 0.25 * x1 + 0.5 * ctrlX + 0.25 * x2;
  const curveMidY = 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2;

  return { ctrlX, ctrlY, curveMidX, curveMidY };
}
