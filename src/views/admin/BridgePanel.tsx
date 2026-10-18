/**
 * Equity bridge editor.
 *
 * The lease controls are the part worth reading twice. A lease liability must
 * be deducted once or not at all, and which it is depends on how the operating
 * profit above it was built. The two controls here make that choice explicit
 * instead of leaving it to be guessed from the numbers.
 */

import type { EquityBridge, ValuationSnapshot } from '../../../shared/types';
import { DEFAULT_EQUITY_BRIDGE, buildEquityBridge } from '../../../shared/dcf';
import { Banner, Button, CheckboxField, NumberField, SelectField, TableFrame } from '../../components/ui';
import { formatCrore, formatCroreSigned, formatPerShare } from '../../lib/format';

export function BridgePanel({
  draft,
  onChange,
  enterpriseValue,
}: {
  draft: ValuationSnapshot;
  onChange: (next: ValuationSnapshot) => void;
  enterpriseValue: number | null;
}) {
  const bridge = draft.assumptions.bridge ?? {
    ...DEFAULT_EQUITY_BRIDGE,
    dilutedShares: draft.assumptions.dilutedSharesCrore,
  };
  const latest = draft.historical[draft.historical.length - 1];

  const setBridge = (patch: Partial<EquityBridge>) => {
    const next = { ...bridge, ...patch };
    // Keep the legacy single net-debt figure in step, so an older consumer of
    // the data file still reads a sensible number.
    const leasesCounted = next.leaseTreatment === 'capitalised' && !next.leasesIncludedInGrossDebt;
    const netDebt =
      next.grossDebt +
      (leasesCounted ? next.leaseLiabilities : 0) +
      next.nonControllingInterests +
      next.otherClaims -
      next.cashAndEquivalents -
      next.nonOperatingInvestments;
    onChange({
      ...draft,
      assumptions: {
        ...draft.assumptions,
        bridge: next,
        netDebtCrore: Math.round(netDebt * 100) / 100,
        dilutedSharesCrore: next.dilutedShares,
      },
    });
  };

  const pullFromLatest = () => {
    if (!latest) return;
    setBridge({
      grossDebt: latest.borrowings ?? bridge.grossDebt,
      leaseLiabilities: latest.leaseLiabilities ?? bridge.leaseLiabilities,
      cashAndEquivalents: latest.cashAndEquivalents ?? bridge.cashAndEquivalents,
      nonOperatingInvestments: latest.nonOperatingInvestments ?? bridge.nonOperatingInvestments,
      nonControllingInterests: latest.nonControllingInterests ?? bridge.nonControllingInterests,
      dilutedShares: latest.dilutedShares ?? bridge.dilutedShares,
    });
  };

  const preview = enterpriseValue === null ? null : buildEquityBridge(enterpriseValue, bridge);
  const leasesCounted = bridge.leaseTreatment === 'capitalised' && !bridge.leasesIncludedInGrossDebt;

  return (
    <div className="stack-6">
      <section className="panel">
        <div className="panel-head">
          <h3>Claims and assets</h3>
          {latest ? (
            <Button variant="secondary" onClick={pullFromLatest}>
              Fill from {latest.year}
            </Button>
          ) : null}
        </div>
        <div className="panel-pad stack-4">
          <p className="text-secondary prose">
            Figures in {draft.company.units || 'the reporting unit'}, taken as at the valuation date. These should tie
            back to the latest reported balance sheet unless something has changed since, in which case say so in the
            research notes.
          </p>
          <div className="field-row">
            <NumberField
              label="Gross debt" unit={draft.company.currency} value={bridge.grossDebt} min={0} step={50}
              onChange={(value) => setBridge({ grossDebt: value ?? 0 })}
              hint="Current and non-current borrowings, before netting off any cash."
            />
            <NumberField
              label="Cash and equivalents" unit={draft.company.currency} value={bridge.cashAndEquivalents} min={0} step={50}
              onChange={(value) => setBridge({ cashAndEquivalents: value ?? 0 })}
              hint="Only cash the business does not need to operate."
            />
          </div>
          <div className="field-row">
            <NumberField
              label="Lease liabilities" unit={draft.company.currency} value={bridge.leaseLiabilities} min={0} step={25}
              onChange={(value) => setBridge({ leaseLiabilities: value ?? 0 })}
              hint="Current and non-current lease liabilities combined."
            />
            <NumberField
              label="Non-operating investments" unit={draft.company.currency} value={bridge.nonOperatingInvestments} min={0} step={25}
              onChange={(value) => setBridge({ nonOperatingInvestments: value ?? 0 })}
              hint="Holdings whose returns are not already inside the forecast cash flow."
            />
          </div>
          <div className="field-row">
            <NumberField
              label="Non-controlling interests" unit={draft.company.currency} value={bridge.nonControllingInterests} step={25}
              onChange={(value) => setBridge({ nonControllingInterests: value ?? 0 })}
              hint="The share of consolidated equity that belongs to minority holders in subsidiaries."
            />
            <NumberField
              label="Other debt-like claims" unit={draft.company.currency} value={bridge.otherClaims} step={25}
              onChange={(value) => setBridge({ otherClaims: value ?? 0 })}
              hint="Preference capital, pension deficits and anything else ranking ahead of ordinary equity."
            />
          </div>
          <NumberField
            label="Diluted shares outstanding"
            unit="crore shares"
            value={bridge.dilutedShares}
            min={0.0001}
            step={0.5}
            onChange={(value) => setBridge({ dilutedShares: value ?? 1 })}
            hint="The per-share figure is equity value divided by this. Use the diluted count, not the basic one."
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Lease treatment</h3>
          <span className="text-meta">Stops a lease being charged for twice</span>
        </div>
        <div className="panel-pad stack-4">
          <SelectField
            label="How leases sit inside operating profit"
            value={bridge.leaseTreatment}
            options={[
              { value: 'capitalised', label: 'Capitalised, so depreciation is in operating profit and interest is below it' },
              { value: 'expensed', label: 'Expensed, so the full lease cost is already inside operating profit' },
            ]}
            onChange={(leaseTreatment) => setBridge({ leaseTreatment })}
            hint="Under Ind AS 116 and IFRS 16 leases are capitalised, which is the usual answer for a recent annual report."
          />
          <CheckboxField
            label="Lease liabilities are already counted inside the gross debt figure above"
            hint="Tick this if the borrowings number you entered includes leases. The liability is then not deducted a second time."
            checked={bridge.leasesIncludedInGrossDebt}
            onChange={(leasesIncludedInGrossDebt) => setBridge({ leasesIncludedInGrossDebt })}
          />

          {bridge.leaseLiabilities > 0 && !leasesCounted ? (
            <Banner tone="warn" title="Lease liabilities are not being deducted">
              {bridge.leasesIncludedInGrossDebt
                ? 'They are already inside gross debt, so deducting them again would charge for the same obligation twice.'
                : 'Lease costs are inside operating profit under the expensed treatment, so the liability is deliberately left out of the bridge.'}
            </Banner>
          ) : null}
          {bridge.leaseLiabilities > 0 && leasesCounted ? (
            <Banner tone="ok" title="Lease liabilities are being deducted once">
              Operating profit excludes lease interest under the capitalised treatment, so the liability belongs in the
              bridge alongside borrowings.
            </Banner>
          ) : null}
        </div>
      </section>

      {preview ? (
        <TableFrame
          title="Bridge as it stands"
          unit={draft.company.units}
          footnote={
            preview.warnings.length > 0
              ? preview.warnings.join(' ')
              : 'Each claim appears once. The running total is what is left for equity after that line.'
          }
        >
          <table className="data">
            <caption className="visually-hidden">Live preview of the enterprise to equity bridge</caption>
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Amount</th>
                <th scope="col">Running total</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr key={line.key} className={line.kind === 'start' || line.kind === 'total' ? 'is-emphasis' : undefined}>
                  <th scope="row">{line.label}</th>
                  <td>
                    <span className={`num${line.kind === 'subtract' ? ' neg' : ''}`}>
                      {line.kind === 'start' || line.kind === 'total'
                        ? formatCrore(line.amount)
                        : formatCroreSigned(line.amount)}
                    </span>
                  </td>
                  <td><span className="num">{formatCrore(line.runningTotal)}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Implied value per share</th>
                <td colSpan={2}>
                  <span className="num">{formatPerShare(preview.equityValue / bridge.dilutedShares)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </TableFrame>
      ) : (
        <Banner tone="warn" title="The bridge cannot be previewed yet">
          The model is not producing an enterprise value, so there is nothing to walk down from. Check the forecast
          assumptions first.
        </Banner>
      )}
    </div>
  );
}
