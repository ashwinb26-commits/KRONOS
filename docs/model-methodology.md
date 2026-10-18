# Model methodology

What the model does, in order, and what it deliberately does not do.

## Purpose

Build an intrinsic valuation from free cash flow to the firm, where every
figure can be traced to a document and every assumption is visible on the page.
The calculations run in the browser from data committed to the repository, so
there is no market data feed and nothing to go stale between releases.

## Data hierarchy

In descending order of how much weight a figure should carry:

1. Consolidated audited annual reports, for reported history
2. Company investor material, clearly labelled as management's own statements
3. Market sources for market-derived inputs such as the risk-free rate or beta,
   each recorded with the date it was observed
4. Analyst assumptions, labelled as assumptions

Never mix standalone and consolidated figures in one series. Keep accounting
policies and financial-year definitions consistent, and record any restatement,
acquisition, disposal or discontinued operation that affects comparability.

## The calculation, step by step

### 1. Forecast revenue and operating profit

Revenue rolls forward from the last reported year at the growth assumed for
each year. Operating profit comes off the margin assumption. Both drivers
accept a single flat value or a year by year path.

```
revenue(t)  = revenue(t-1) x (1 + growth(t))
EBIT(t)     = revenue(t) x margin(t)
```

### 2. Convert profit to cash

```
NOPAT(t)    = EBIT(t) x (1 - tax rate(t))
FCFF(t)     = NOPAT(t) + D&A(t) - capex(t) - change in operating NWC(t)
```

Tax is charged on positive operating profit only. Depreciation and capital
expenditure are set as a percentage of revenue. Capital expenditure can
alternatively be charged on incremental revenue, which treats it as growth
capital only. Working capital moves with incremental revenue by default, or
with total revenue if that method is selected.

Operating net working capital excludes cash and all financing items, so the
change in it reflects operations rather than financing.

### 3. Discount

```
discount factor(t) = 1 / (1 + WACC) ^ t
```

With mid-year discounting the exponent becomes `t - 0.5`, which assumes cash
arrives through the year rather than all on the last day. It raises the
valuation slightly and is usually the more realistic choice.

The discount rate is either assumed directly or built from its parts:

```
cost of equity         = risk-free rate + beta x equity risk premium + add-on
cost of debt after tax = cost of debt before tax x (1 - marginal tax rate)
WACC                   = equity weight x cost of equity
                       + debt weight x cost of debt after tax
```

The 2 weights must total 100%. Market value weights where available.

### 4. Terminal value

```
terminal value = FCFF(final year) x (1 + g) / (WACC - g)
```

It sits at the end of the forecast window, so it is then discounted back over
the same number of years. It only means anything while `g` is below `WACC`, and
the model refuses to calculate otherwise rather than returning a number. It
also refuses when free cash flow in the final year is 0 or negative, because
the formula is meaningless there.

The share of enterprise value coming from terminal value is reported on the
dashboard. It is the single most useful number for judging how much of a
valuation rests on assumption rather than forecast.

### 5. Enterprise value to value per share

```
enterprise value = sum of discounted FCFF + discounted terminal value
equity value     = enterprise value
                   - gross debt
                   - lease liabilities, see below
                   - non-controlling interests
                   - other debt-like claims
                   + cash and equivalents
                   + non-operating investments
value per share  = equity value / diluted shares outstanding
```

Every claim appears once. The one case needing care is leases, and the model
makes the choice explicit rather than inferring it:

- **Capitalised**, which is the Ind AS 116 and IFRS 16 treatment: depreciation
  on the right-of-use asset is inside operating profit and lease interest is
  below it, so the lease liability is a debt-like claim and is deducted.
- **Expensed**: the full lease cost is already inside operating profit, so
  deducting the liability as well would charge for the same obligation twice.
  The model does not deduct it, and says so.
- **Already inside gross debt**: not deducted again, and the model says so.

## Before using real figures

- [ ] Reconcile the balance sheet, the cash flow statement and the debt and
      cash disclosures
- [ ] Confirm operating working capital excludes cash and financing items
- [ ] Confirm capital expenditure has the right sign and scope
- [ ] Deal with leases, minority interests, investments, pensions and other
      debt-like claims where they are material
- [ ] Use a nominal discount rate with nominal cash flows, in one currency
- [ ] Make the valuation date explicit
- [ ] Justify each cost of capital input and record its observation date
- [ ] Keep terminal growth below the discount rate, and test a range rather
      than one point
- [ ] Reconcile the site's output against an independent spreadsheet for the
      same inputs
- [ ] Run the edge cases: a discount rate approaching terminal growth, net cash
      instead of net debt, and a changed share count

## What the model simplifies

Stated plainly, because a model whose limitations are not written down will be
over-trusted.

- **Driver-based forecasting, not schedule based.** Depreciation and capital
  expenditure are percentages of revenue rather than an asset roll-forward.
  Working capital moves with incremental revenue. This is reasonable for a
  stable manufacturer and poor for a business in the middle of a capital cycle.
- **A single effective tax rate on positive operating profit.** No deferred
  tax, no carried-forward losses, no one-off tax items.
- **Constant terminal growth forever.** The usual criticism of a perpetuity, and
  the usual answer is the sensitivity grid rather than a better formula.
- **No explicit modelling of segments, geographies or currency exposure.**
- **No competitive position in the model.** The assumptions carry all of it,
  which is why the scenario reasoning matters more than the arithmetic.

Upgrade the model only when the historical evidence and the business drivers
justify the extra complexity. A more detailed model built on the same guesses
is not a better model.
