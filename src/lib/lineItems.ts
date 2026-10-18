/**
 * The order financial statements are read in, shared by the public tables and
 * the editor so both show the same lines in the same sequence.
 */

import type { HistoricalFigureKey } from '../../shared/types';

export interface LineItemGroup {
  heading: string;
  /** Statement name pre-filled into the provenance editor for these lines. */
  statement: string;
  keys: HistoricalFigureKey[];
}

export const LINE_ITEM_GROUPS: LineItemGroup[] = [
  {
    heading: 'Statement of profit and loss',
    statement: 'Consolidated statement of profit and loss',
    keys: [
      'revenue',
      'operatingExpenses',
      'ebitda',
      'depreciation',
      'ebit',
      'financeCosts',
      'profitBeforeTax',
      'taxExpense',
      'netProfit',
    ],
  },
  {
    heading: 'Balance sheet',
    statement: 'Consolidated balance sheet',
    keys: [
      'cashAndEquivalents',
      'borrowings',
      'leaseLiabilities',
      'receivables',
      'inventories',
      'tradePayables',
      'otherOperatingAssets',
      'otherOperatingLiabilities',
      'propertyPlantEquipment',
      'nonControllingInterests',
      'nonOperatingInvestments',
    ],
  },
  {
    heading: 'Cash flow statement',
    statement: 'Consolidated statement of cash flows',
    keys: ['operatingCashFlow', 'capex', 'changeInWorkingCapital', 'otherInvestingItems'],
  },
  {
    heading: 'Capital structure',
    statement: 'Earnings per share note',
    keys: ['dilutedShares'],
  },
  {
    heading: 'Working capital override',
    statement: 'Derived from the balance sheet',
    keys: ['operatingNwc'],
  },
];

/** Lines the engine cannot run without. */
export const REQUIRED_KEYS: HistoricalFigureKey[] = ['revenue', 'ebit', 'depreciation', 'capex'];

/** Lines the analyst may leave empty. */
export function isOptionalKey(key: HistoricalFigureKey): boolean {
  return !REQUIRED_KEYS.includes(key);
}

export const LINE_ITEM_HELP: Partial<Record<HistoricalFigureKey, string>> = {
  revenue: 'Revenue from operations, excluding other income.',
  operatingExpenses: 'Total expenses before depreciation and finance costs.',
  ebitda: 'Operating profit before depreciation. Leave empty to skip the reconciliation check.',
  depreciation: 'Depreciation and amortisation, as a positive figure.',
  ebit: 'Operating profit after depreciation and before finance costs.',
  capex: 'Purchase of property, plant and equipment, entered as a positive outflow.',
  operatingNwc:
    'Leave empty to derive working capital from receivables, inventories and payables. Enter a figure only to override that.',
  dilutedShares: 'Weighted average diluted shares, in the same unit as the bridge share count.',
  leaseLiabilities: 'Current and non-current lease liabilities combined.',
};
