/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BinSpecModel } from '../types';
import excelImportedModels from './excelBinDatabase.json';

export const BIN_DATABASE: BinSpecModel[] = (excelImportedModels as any[]) as BinSpecModel[];

export const MANUFACTURERS = [
  'All Manufacturers',
  'Brock',
  'Brock Everest',
  'Darmani',
  'GSI',
  'Meridian',
  'SCAFCO',
  'Sioux Steel',
  'Sukup',
  'Superior Grain',
  'Westeel',
];

export const BIN_CATEGORIES = [
  'All Types',
  'Flat Bottom',
  'Hopper Bottom',
  'Smoothwall Hopper',
];
