/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Point {
  x: number;
  y: number;
}

export interface MeasurementLine {
  p1: Point;
  p2: Point | null;
}

export interface BaseAsset {
  id: number;
  name: string;
  notes: string;
  x: number;
  y: number;
}

export interface BinSpecModel {
  id: string;
  manufacturer: string;
  modelNumber: string;
  fullName: string;
  category: 'Flat Bottom' | 'Hopper Bottom' | 'Smoothwall Hopper';
  isHopper: boolean;
  stiffened: boolean;
  diameterFt: number;
  rings: number;
  eaveHeightFt: number;
  totalHeightFt: number;
  floorThicknessFt?: number;
  hopperConeHeightFt?: number;
  hopperConeAngleDeg?: number;
  capacityBushels: number;
  capacityMetricTonnesWheat?: number;
  peakLoadCapLbs?: number;
  recommendedCablesCount?: number;
  recommendedSensorsPerCable?: number;
  recommendedCableLengthFt?: number;
  verifiedCenterCableFt?: string;
  verifiedRadiusCableFt?: string;
  doorType?: string;
  roofCapDiameterInches?: number;
  notes?: string;
}

export interface BinAsset extends BaseAsset {
  type: 'bin';
  diameter: string;
  rings: string;
  eaveHeight: string;
  totalHeight: string;
  floorThick: string;
  measurements: MeasurementLine[];
  centerCable?: string;
  radiusCable?: string;
  isHopper?: boolean;
  hopperConeHeight?: string;
  manufacturer?: string;
  modelNumber?: string;
  capacityBushels?: number;
}

export interface MarkerAsset extends BaseAsset {
  type: 'chester-x' | 'chester-x1' | 'junction-box' | 'fan-control';
  diameter: string;
}

export interface ZoneAsset extends BaseAsset {
  type: 'zone';
  width: string;
  height: string;
}

export type Asset = BinAsset | MarkerAsset | ZoneAsset;

export interface WireConnection {
  id: number;
  fromId: number;
  toId: number;
  type: 'cat5' | 'female-link';
  bendX?: number;
  bendY?: number;
}

export interface Yard {
  id: number;
  name: string;
  location?: string;
  bins: Asset[];
  wires?: WireConnection[];
}

export interface Customer {
  name: string;
  phone: string;
  email?: string;
  location?: string;
}

export interface Project {
  id: string;
  driveFileId?: string;
  name: string;
  customer: Customer;
  date: string;
  activeYardId: number | null;
  yards: Yard[];
  notes?: string;
}

export function generateProjectId(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `PRJ-${num}`;
}

// Monotonic counter guarantees a unique id even when several assets are
// created within the same millisecond (fast clicks, batch add/duplicate),
// which a bare `Date.now()` cannot.
let assetIdCounter = 0;
export function generateAssetId(): number {
  assetIdCounter += 1;
  return Date.now() * 1000 + (assetIdCounter % 1000);
}
