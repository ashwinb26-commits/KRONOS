/**
 * Display helpers. The calculation formatters come from the shared engine so
 * the dashboard and the studio render identical figures.
 */

export { formatCrore, formatCroreSigned, formatPerShare, formatPercent } from '../../shared/dcf';

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(iso: string): string {
  if (!iso) return 'not set';
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormatter.format(date);
}

export function formatShortDate(iso: string): string {
  if (!iso) return 'not set';
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return shortDateFormatter.format(date);
}

/** A figure or an em-free placeholder, never a bare dash with no meaning. */
export function orNotEntered(value: number | null | undefined, render: (value: number) => string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'not entered';
  return render(value);
}

export const DATA_STATUS_COPY: Record<string, { word: string; className: string; blurb: string }> = {
  illustrative: {
    word: 'Illustrative placeholders',
    className: 'state state-illustrative',
    blurb:
      'The figures on this page are invented placeholders used to test the model and the interface. They are not reported company data.',
  },
  'in-review': {
    word: 'Extraction in progress',
    className: 'state state-review',
    blurb:
      'Figures have been extracted from the annual reports but not every line has been checked against its source yet.',
  },
  verified: {
    word: 'Verified against sources',
    className: 'state state-verified',
    blurb:
      'Every reported figure on this page has been checked against the annual report page recorded beside it.',
  },
};

export const VERIFICATION_COPY: Record<string, { word: string; className: string }> = {
  unverified: { word: 'Not checked', className: 'state state-illustrative' },
  'cross-checked': { word: 'Cross-checked', className: 'state state-review' },
  verified: { word: 'Verified', className: 'state state-verified' },
};

export const CLASSIFICATION_COPY: Record<string, string> = {
  reported: 'Reported',
  derived: 'Derived',
  assumption: 'Assumption',
};
