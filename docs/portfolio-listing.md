# Portfolio listing

## DCF Valuation Lab

**Financial modelling, equity research, full-stack build**

An interactive discounted cash flow valuation site for an Indian manufacturer,
with a protected research studio that publishes dated snapshots straight to
GitHub.

The model covers 5 years of reported history, a 5 year free cash flow forecast,
a cost of capital built from its components, terminal value, an itemised
enterprise to equity bridge, a sensitivity grid and 3 scenarios. Every reported
figure carries the document, page and verification state it came from.

Each release is kept as an immutable dated snapshot, so a valuation published 6
months ago can be compared against the next one and against what actually
happened.

Built with React, TypeScript and Vite on Cloudflare Pages. Sign-in runs through
GitHub OAuth against a server-side allowlist, and publishing commits the data
file through the GitHub API from a Pages Function, with server-side
revalidation, recalculation and SHA-based concurrency control. 211 tests cover
the formulas, the validator, access control and the publication pipeline.

**Current status:** The application is complete. The dataset shipped with it is
illustrative, and is marked as such on the site. The first company-specific
valuation follows source extraction and verification.

**Link text:** `Open DCF Valuation Lab`
