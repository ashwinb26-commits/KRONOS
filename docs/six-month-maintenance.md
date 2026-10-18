# Six-month maintenance guide

The research cycle, from a new annual report to a published snapshot. Budget
half a day for the first one and 2 to 3 hours after that.

The reason for the cadence is not tidiness. It is that a valuation you
published 6 months ago, kept exactly as it was, is the only way to find out
whether your forecasting is any good. Comparing what you expected against what
happened is the part that teaches you something. Everything else is bookkeeping
in service of that.

## Before you start

Have ready:

- The new consolidated annual report or interim result, downloaded and saved
  with its date
- The previously published snapshot, which the studio shows you automatically
- Current market inputs for the cost of capital, with the date you observed
  them

## Stage 1: Look back before you look forward

Do this first, before touching a single number. Once you start editing, the old
forecast stops being a prediction and becomes a thing you are tempted to tidy
up.

On the dashboard, select the previous release in **Published release**, and
write down what it forecast for the year that has now actually been reported.
Then answer these in the publication notes as you go:

- [ ] What did last release's forecast say revenue would be? What was it?
- [ ] What did it say the operating margin would be? What was it?
- [ ] Which single assumption was most wrong, and why was it wrong? Was it a
      bad read on the business, or did something genuinely unforeseeable
      happen?
- [ ] Did the business do anything that the model has no way to represent, such
      as an acquisition, a disposal or a change in segment reporting?

Writing "revenue came in 4% below forecast because volume growth in the
decorative segment stalled" is worth more than any amount of model refinement.

## Stage 2: Extract the new year

Open the studio at **Historical data**.

- [ ] Add the new financial year with **Add financial year**. The label is
      suggested from the last one.
- [ ] Enter the statements. Required figures are revenue, operating profit,
      depreciation and capital expenditure. Everything else is optional, and
      everything else makes the reconciliation checks more useful.
- [ ] Check the consolidation basis has not changed. Never mix consolidated and
      standalone figures inside one series.
- [ ] Check for restatements. If the company restated a prior year, update that
      year too, and say so in the publication notes. Published snapshots keep
      their original figures, so the restatement shows up as a diff rather than
      quietly rewriting history.
- [ ] Watch the derived rows at the bottom of the sheet. If operating working
      capital or the operating margin look wrong, a balance sheet line is
      probably in the wrong row or the wrong sign.

### Then the source trail

This is the part that gets skipped, and it is the part that makes the project
worth showing anybody.

- [ ] For each line, set the document, the statement, the page and the unit
- [ ] Use the copy button at the end of each row to apply the document,
      statement and kind to every year at once. It deliberately leaves page
      numbers alone, since those differ year to year.
- [ ] Set each reported line to **Verified against the source page** only once
      you have actually looked at that page
- [ ] Anything the model works out rather than reads should be marked
      **Derived**, and anything you chose should be marked **Assumption**

The **Validate and publish** section counts how many reported figures are
verified, so you can see how far through you are.

## Stage 3: Revisit the assumptions

Open **Assumptions**. Change these because the evidence changed, not because
the output looked wrong.

- [ ] **Revenue growth.** Does the path still hold given what actually
      happened? Use the year by year override table rather than one flat number
      if growth should taper.
- [ ] **Operating margin.** Input costs, pricing, mix and capacity. Compare the
      forecast margin against the last 5 reported years before settling on it.
- [ ] **Depreciation and capital expenditure.** Check the forecast ratios
      against the historical ones. A capital expenditure assumption well below
      the historical average needs a reason.
- [ ] **Working capital.** Compare the incremental assumption against what
      actually happened to receivables, inventories and payables.
- [ ] **Tax.** The effective rate on operating profit, not the headline rate.

### The cost of capital

- [ ] Re-source the risk-free rate and record the date you observed it in the
      research notes
- [ ] Revisit beta, and record the window and index used
- [ ] Revisit the equity risk premium and the cost of debt
- [ ] Update the capital weights if the capital structure moved
- [ ] Revisit terminal growth. It has to stay below the discount rate, and
      above long-run nominal economic growth it needs an argument.

### The bridge

Open **Equity bridge**.

- [ ] Use **Fill from** the latest year to pull debt, cash, leases and the share
      count off the new balance sheet
- [ ] Confirm the lease treatment still matches how operating profit was built
- [ ] Update the diluted share count if there was a buyback, an issue or
      dilution

The pinned bar at the bottom of the screen shows the value per share moving as
you work, with the change against the published figure beside it.

## Stage 4: Check the shape of the answer

Open **Validate and publish**.

- [ ] Fix everything under **Blocking problems**. Each has a **Go to** button.
- [ ] Read everything under **Worth reading before publishing**. Reconciliation
      gaps are sometimes the right answer, but they should be a decision rather
      than an oversight.
- [ ] Look at the terminal value share on the dashboard. Above 80% and the
      valuation is mostly an opinion about the far future, which is worth
      saying out loud in the research notes.
- [ ] Look at the sensitivity grid. The spread across it is the honest range.
- [ ] Review the 3 scenarios. Each should be a coherent story about the
      business, not the base case with the growth rate nudged.

## Stage 5: Publish

- [ ] Set the **Valuation date**. The snapshot identifier comes from it.
- [ ] Set the **Data status**. **Verified** requires every reported figure to be
      verified, and the validator enforces it.
- [ ] Raise the **Model version** only if the method changed. Changing figures
      is not a method change.
- [ ] Write the **Publication notes**: what changed, what you got wrong last
      time, and what you now think the main risk is. This goes into the commit
      message and the release history.
- [ ] Select **Preview update** and read the diff. Anything in there you did not
      mean to change is a mistake you just caught.
- [ ] Select **Publish update** and confirm.
- [ ] Follow the commit link to check it landed, then wait a minute or 2 for
      Cloudflare to redeploy.
- [ ] Open the dashboard and confirm both releases appear in the selector, and
      that **Compare against** shows the movement.

## Stage 6: Write the note

The site holds the model. It does not hold your thinking. Write 300 words
somewhere, even if only for yourself:

- What changed in the business this period
- Which forecast was most wrong, and what that taught you
- What evidence moved the assumptions
- How the implied value range moved, and whether the move is explained by
  evidence or by you changing your mind
- What you still do not know that matters most

## If something goes wrong

**The studio says the data file changed in GitHub.** Something else committed
it since you loaded. Select **Reload published data**, re-apply your edits, and
publish again. Nothing was overwritten, which is the point of the check.

**You published something wrong.** Nothing is deleted, so the fix is to publish
a correction: a new snapshot with the right figures and a publication note
saying what was wrong. If the bad snapshot has to come out entirely, edit
`public/data/valuations.json` in the repository by hand, remove it from
`snapshots`, point `current` at the right identifier, and commit. The studio
will not do this for you on purpose.

**Draft work disappeared.** Drafts live in the browser's local storage, per
browser and per device. They survive a refresh and a closed tab, and they do
not survive clearing site data, a private window, or a different machine.

**A publish fails repeatedly.** Use **Copy error details** on the error, which
copies the code, the reference and the time with no secrets in it. The
troubleshooting tables in [setup-guide.md](setup-guide.md) cover each code.

## Between cycles

Nothing scheduled, but worth doing if an interim result lands:

- Add the interim figures to the research notes rather than the historical
  series, which should stay annual and audited
- If something material happens, such as an acquisition or a guidance change,
  publish an off-cycle snapshot. The cadence is a default, not a rule.
