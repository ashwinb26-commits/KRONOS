/**
 * Pure helpers for editing a snapshot draft.
 *
 * Every function returns a new object rather than mutating, so React sees the
 * change and the draft can be serialised to local storage after each edit.
 */

import { nextFinancialYearLabel } from '../../../shared/dcf';
import type {
  Classification,
  FigureProvenance,
  HistoricalFigureKey,
  HistoricalYear,
  ValuationSnapshot,
  Verification,
} from '../../../shared/types';

export const BLANK_PROVENANCE: FigureProvenance = {
  sourceId: '',
  page: '',
  statement: '',
  unit: '',
  classification: 'reported',
  verification: 'unverified',
};

export function emptyHistoricalYear(year: string): HistoricalYear {
  return {
    year,
    revenue: 0,
    operatingExpenses: null,
    ebitda: null,
    depreciation: 0,
    ebit: 0,
    financeCosts: null,
    profitBeforeTax: null,
    taxExpense: null,
    netProfit: null,
    cashAndEquivalents: null,
    borrowings: null,
    receivables: null,
    inventories: null,
    tradePayables: null,
    propertyPlantEquipment: null,
    otherOperatingAssets: null,
    otherOperatingLiabilities: null,
    leaseLiabilities: null,
    nonControllingInterests: null,
    nonOperatingInvestments: null,
    operatingCashFlow: null,
    capex: 0,
    changeInWorkingCapital: null,
    otherInvestingItems: null,
    dilutedShares: null,
    operatingNwc: null,
    provenance: {},
  };
}

/** The label after the last year in the draft, or a sensible first year. */
export function suggestNextYear(years: string[]): string {
  const last = years[years.length - 1];
  if (!last) {
    const now = new Date();
    // An Indian financial year runs April to March, so a date in January to
    // March still belongs to the year that started the previous April.
    const startYear = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    return `FY${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  }
  return nextFinancialYearLabel(last) ?? last;
}

export function setFigure(
  snapshot: ValuationSnapshot,
  yearIndex: number,
  key: HistoricalFigureKey,
  value: number | null,
): ValuationSnapshot {
  const historical = snapshot.historical.map((row, index) =>
    index === yearIndex ? { ...row, [key]: value } : row,
  );
  return { ...snapshot, historical };
}

export function setYearLabel(
  snapshot: ValuationSnapshot,
  yearIndex: number,
  year: string,
): ValuationSnapshot {
  const historical = snapshot.historical.map((row, index) =>
    index === yearIndex ? { ...row, year } : row,
  );
  return { ...snapshot, historical };
}

export function setProvenanceField(
  snapshot: ValuationSnapshot,
  yearIndex: number,
  key: HistoricalFigureKey,
  patch: Partial<FigureProvenance>,
): ValuationSnapshot {
  const historical = snapshot.historical.map((row, index) => {
    if (index !== yearIndex) return row;
    const current = row.provenance?.[key] ?? BLANK_PROVENANCE;
    return {
      ...row,
      provenance: { ...(row.provenance ?? {}), [key]: { ...current, ...patch } },
    };
  });
  return { ...snapshot, historical };
}

/**
 * Copy one line's source details across every year.
 *
 * Entering a statement name, unit and document 26 times per year is the kind
 * of work that gets skipped, and skipped provenance is the whole point of this
 * project. The page number is deliberately left alone, because it genuinely
 * differs year to year.
 */
export function applyProvenanceToAllYears(
  snapshot: ValuationSnapshot,
  key: HistoricalFigureKey,
  template: Pick<FigureProvenance, 'sourceId' | 'statement' | 'unit' | 'classification'>,
): ValuationSnapshot {
  const historical = snapshot.historical.map((row) => {
    const current = row.provenance?.[key] ?? BLANK_PROVENANCE;
    return {
      ...row,
      provenance: {
        ...(row.provenance ?? {}),
        [key]: { ...current, ...template },
      },
    };
  });
  return { ...snapshot, historical };
}

export function addYear(snapshot: ValuationSnapshot): ValuationSnapshot {
  const year = suggestNextYear(snapshot.historical.map((row) => row.year));
  if (snapshot.historical.some((row) => row.year === year)) return snapshot;
  return { ...snapshot, historical: [...snapshot.historical, emptyHistoricalYear(year)] };
}

export function removeYear(snapshot: ValuationSnapshot, year: string): ValuationSnapshot {
  return { ...snapshot, historical: snapshot.historical.filter((row) => row.year !== year) };
}

/** Copy the previous year's figures into a year, as a starting point to edit. */
export function copyPreviousYear(snapshot: ValuationSnapshot, yearIndex: number): ValuationSnapshot {
  if (yearIndex <= 0) return snapshot;
  const previous = snapshot.historical[yearIndex - 1];
  const target = snapshot.historical[yearIndex];
  const historical = snapshot.historical.map((row, index) =>
    index === yearIndex ? { ...previous, year: target.year, provenance: { ...previous.provenance } } : row,
  );
  return { ...snapshot, historical };
}

export const CLASSIFICATION_OPTIONS: Array<{ value: Classification; label: string }> = [
  { value: 'reported', label: 'Reported, read off the statement' },
  { value: 'derived', label: 'Derived by calculation' },
  { value: 'assumption', label: 'Assumption chosen by the analyst' },
];

export const VERIFICATION_OPTIONS: Array<{ value: Verification; label: string }> = [
  { value: 'unverified', label: 'Not checked yet' },
  { value: 'cross-checked', label: 'Cross-checked against another statement' },
  { value: 'verified', label: 'Verified against the source page' },
];

/**
 * Seed a new draft from the published snapshot.
 *
 * The valuation and publication dates move to today, because a new release is
 * struck now, and the identifier is left for the server to assign.
 */
export function draftFromPublished(
  published: ValuationSnapshot,
  today: string,
): ValuationSnapshot {
  return {
    ...published,
    id: `snap-${today}`,
    createdAt: new Date().toISOString(),
    publishedBy: '',
    publicationNotes: '',
    commitSha: undefined,
    company: { ...published.company, valuationDate: today, publicationDate: today },
  };
}

/** How complete the source trail is, for the publish checklist. */
export function verificationSummary(snapshot: ValuationSnapshot): {
  reported: number;
  verified: number;
  missingSource: number;
  missingPage: number;
  total: number;
} {
  let reported = 0;
  let verified = 0;
  let missingSource = 0;
  let missingPage = 0;
  let total = 0;

  for (const row of snapshot.historical) {
    for (const entry of Object.values(row.provenance ?? {})) {
      if (!entry) continue;
      total += 1;
      if (entry.classification !== 'reported') continue;
      reported += 1;
      if (entry.verification === 'verified') verified += 1;
      if (!entry.sourceId) missingSource += 1;
      if (!entry.page.trim()) missingPage += 1;
    }
  }

  return { reported, verified, missingSource, missingPage, total };
}
