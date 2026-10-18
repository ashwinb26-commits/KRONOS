# Data schema

`public/data/valuations.json` is the source of truth. The public dashboard
reads it as a static asset. The studio reads the repository's copy through
`/api/data` and commits updates to it.

The shape is defined in `shared/types.ts` and enforced by `shared/validation.ts`
on both the client and the server.

## The file

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-10-17T00:00:00.000Z",
  "current": "snap-2026-10-17",
  "snapshots": [ ... ]
}
```

| Field | Notes |
| --- | --- |
| `schemaVersion` | 2. Raise it only for a breaking change, and write a migration when you do. |
| `generatedAt` | When the file was last written. Informational. |
| `current` | The snapshot the dashboard shows by default. If it does not resolve, the last snapshot is used. |
| `snapshots` | Every published release, oldest valuation date first. Append only. Capped at 40. |

## A snapshot

Immutable once published. Publishing appends a new one and moves `current`.

| Field | Notes |
| --- | --- |
| `id` | `snap-YYYY-MM-DD`, from the valuation date. A second release on the same date gets `-2`. **Assigned by the server**, so whatever the client sends is replaced. |
| `createdAt` | Set by the server at publication. |
| `publishedBy` | The GitHub login from the session. Set by the server. |
| `modelVersion` | Semantic version of the method, as in `1.0.0`. Raise it when the method changes, not when figures change. |
| `publicationNotes` | What changed and why. Up to 1200 characters. Goes into the commit message. |
| `dataStatus` | `illustrative`, `in-review` or `verified`. Drives the public banner. `verified` is gated on the source trail. |
| `company` | Identity, reporting basis and dates. |
| `sources` | The documents figures were extracted from. |
| `historical` | Reported years, oldest first. |
| `assumptions` | Forecast drivers, cost of capital and the equity bridge. |
| `scenarios` | Exactly `bull`, `base` and `bear`. |
| `sensitivity` | The 2 axes of the grid. |
| `results` | Outputs **as recomputed on the server** at publication. Stored for audit. The dashboard recalculates from inputs and never reads this. |
| `commitSha` | Reserved. Left unset, because the commit hash is not known until after the write that contains it. The git history is the record. |

### `company`

All fields required. Dates are `YYYY-MM-DD`. Financial years are `FY2024-25`.

`name`, `ticker`, `exchange`, `sector`, `currency` (3 letters), `units`,
`consolidationBasis` (`Consolidated` or `Standalone`), `fiscalYearEnd`,
`reportingPeriod`, `valuationDate`, `publicationDate`, `researchNotes` (up to
4000 characters, blank lines separate paragraphs).

### `sources`

```json
{
  "id": "annual-report-fy2024-25",
  "label": "Integrated Annual Report 2024-25",
  "url": "https://example.com/annual-report-2024-25.pdf",
  "reportYear": "FY2024-25",
  "retrievedOn": "2026-04-30",
  "notes": "Segment reporting changed this year."
}
```

`id` is a lowercase slug and is what figures reference. `url` must be `http://`
or `https://`. Up to 40 documents.

### `historical`

One object per financial year, oldest first, up to 15. Figures are in the unit
named in `company.units`, except `dilutedShares`, which is a share count.

Required: `year`, `revenue` (above 0), `ebit`, `depreciation` (0 or more),
`capex` (0 or more, entered as a positive outflow).

Optional, `null` when not extracted:

- Profit and loss: `operatingExpenses`, `ebitda`, `financeCosts`,
  `profitBeforeTax`, `taxExpense`, `netProfit`
- Balance sheet: `cashAndEquivalents`, `borrowings`, `receivables`,
  `inventories`, `tradePayables`, `propertyPlantEquipment`,
  `otherOperatingAssets`, `otherOperatingLiabilities`, `leaseLiabilities`,
  `nonControllingInterests`, `nonOperatingInvestments`
- Cash flow: `operatingCashFlow`, `changeInWorkingCapital`,
  `otherInvestingItems`
- Capital: `dilutedShares`
- `operatingNwc`: an override. Left `null`, the engine derives it as
  receivables plus inventories plus other operating assets, less trade payables
  and other operating liabilities. Cash and borrowings are deliberately
  excluded so the change in working capital does not pick up financing.

### `provenance`

Keyed by line item. Any key not in the line item list is rejected.

```json
"revenue": {
  "sourceId": "annual-report-fy2024-25",
  "page": "142",
  "statement": "Consolidated statement of profit and loss",
  "unit": "INR crore",
  "classification": "reported",
  "verification": "verified"
}
```

- `classification`: `reported` (read off the statement), `derived` (calculated)
  or `assumption` (chosen by the analyst). A `reported` entry must name a
  `sourceId` that exists in `sources`.
- `verification`: `unverified`, `cross-checked` or `verified`. Publishing with
  `dataStatus: "verified"` requires every `reported` entry to be `verified`.

### `assumptions`

Flat drivers, which apply to every forecast year unless overridden:
`revenueGrowthPct`, `ebitMarginPct`, `taxRatePct`, `depreciationPctRevenue`,
`capexPctRevenue`, `nwcPctIncrementalRevenue`, `terminalGrowthPct`.

`waccPct` is the legacy discount rate and is recomputed from `wacc` when that
is present. `netDebtCrore` and `dilutedSharesCrore` are the legacy single
figures, superseded by `bridge`. Both are kept in step so an older reader of
the file still gets sensible numbers.

Shape: `forecastYears` (1 to 15), `firstForecastYearLabel`, `capexMethod`
(`pctRevenue` or `pctIncrementalRevenue`), `nwcMethod`
(`pctIncrementalRevenue` or `pctRevenue`), `midYearConvention`.

`perYear` holds overrides as arrays, one entry per forecast year. `null` falls
back to the flat driver:

```json
"perYear": { "revenueGrowthPct": [8, 7.5, 7, 6.5, 6] }
```

`wacc`: `mode` (`derived` or `manual`), `riskFreeRatePct`, `betaLevered`,
`equityRiskPremiumPct`, `additionalEquityPremiumPct`, `costOfDebtPreTaxPct`,
`marginalTaxRatePct`, `equityWeightPct`, `debtWeightPct`, `manualWaccPct`. In
`derived` mode the 2 weights must total 100%.

`bridge`: `grossDebt`, `leaseLiabilities`, `leasesIncludedInGrossDebt`,
`leaseTreatment` (`capitalised` or `expensed`), `cashAndEquivalents`,
`nonOperatingInvestments`, `nonControllingInterests`, `otherClaims`,
`dilutedShares`.

The 2 lease fields exist to stop a lease being charged for twice. A lease
liability is deducted only when `leaseTreatment` is `capitalised` and
`leasesIncludedInGrossDebt` is false. In either other case the engine skips it
and says why in its warnings.

### `scenarios` and `sensitivity`

```json
"scenarios": {
  "bull": { "label": "Bull", "notes": "...", "overrides": { "revenueGrowthPct": 9 } },
  "base": { "label": "Base", "notes": "...", "overrides": {} },
  "bear": { "label": "Bear", "notes": "...", "overrides": { "waccPct": 11.5 } }
},
"sensitivity": {
  "waccPct": [8.5, 9.5, 10.5, 11.5, 12.5],
  "terminalGrowthPct": [2, 3, 4, 5, 6]
}
```

Overrides are limited to the forecast drivers, `waccPct` and
`terminalGrowthPct`. Each sensitivity axis takes 2 to 9 values, listed low to
high with no repeats.

## Editing the file by hand

Normally the studio writes it. If you edit it directly, remember:

- Run `npm run test:run` afterwards. `tests/validation.test.ts` validates the
  committed file, so a broken edit fails the build rather than the deployment.
- Keep `current` pointing at a snapshot that exists.
- Keep historical years oldest first, with no duplicates.
- The publish endpoint refuses to write over a file it cannot parse, so a
  broken file blocks publishing until it is fixed.

`npm run seed` regenerates the illustrative file from scratch, running the real
engine and validator. It overwrites whatever is there, so do not run it once
you have real research in the file.
