# Family Investment Review Agent Specification

Status: approved for specification; not yet scheduled or connected to financial accounts  
Last updated: 2026-08-24

## 1. Purpose

Build a read-only ChatGPT Work/CoWork teammate that prepares a source-linked weekly review of the family's Fidelity and crypto investments. The teammate helps Vic and Johana understand contributions, portfolio changes, concentration, material fund or company news, and missing app data.

It does not act as a fiduciary, place orders, transfer funds, rebalance accounts, or make account changes. Every proposed action remains a decision for Vic and Johana.

The workflow follows the official OpenAI patterns of a context-aware project teammate, source-backed recurring review, and research synthesis:

- https://learn.chatgpt.com/use-cases

## 2. Household investment policy

### Goals and risk

- Primary goals: retirement security and long-term wealth.
- Review horizon: approximately 40 years, through Vic's age 85.
- Drawdown tolerance: Vic expects to hold through a decline of approximately 40%.
- Review cadence: weekly, not daily.
- Rebalancing authority: none. The agent may identify drift and explain options, but it may not trade or transfer.

### Account scope

Included:

- Fidelity taxable accounts, clearly labeled as taxable and assigned to Vic or Johana.
- Fidelity Roth IRA accounts, clearly assigned to Vic or Johana.
- River, for Bitcoin only.
- Kraken, for the currently used stablecoins, XRP, ETH, and other expressly added crypto assets.
- Individual stocks present in imported holdings or pending activity, including SPXC.
- A separate IPO/watchlist collection that is never treated as a holding unless an actual purchase is recorded.

Excluded for now:

- TSP holdings and C/S Fund recommendations.
- Coinbase.
- Automatic brokerage, exchange, or bank actions.

The app may retain the current $549 TSP contribution as household cash-flow context, but the weekly investment reviewer must not analyze or recommend TSP allocations.

### Personal annual contribution targets

| Owner | Account | Personal annual target | Monthly pace |
| --- | --- | ---: | ---: |
| Johana | Roth IRA | $6,000 | $500.00 |
| Vic | Roth IRA | $7,000 | $583.33 |
| Household | Roth IRAs combined | $13,000 | $1,083.33 |

These are household targets, not statements of the statutory maximum. The app must store the personal target separately from the IRS limit and eligibility status.

For tax year 2026, the IRS states that the individual IRA contribution limit is $7,500 for people under age 50, subject to compensation and modified-AGI eligibility. The same individual limit is shared across that person's traditional and Roth IRAs.

Official references:

- https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
- https://www.irs.gov/retirement-plans/roth-iras

The reviewer must not independently conclude that either spouse is Roth-eligible. Because the household is stationed in Germany, it should show an annual "eligibility confirmation needed" status until income and filing treatment have been confirmed with appropriate tax guidance.

### Crypto policy

- Contribution budget: $200-$300 per month through Vic's age 58.
- Monitoring ceiling: 10% of the household's investable portfolio.
- The ceiling is an alert threshold, not an automatic sell rule.
- Bitcoin at River and assets at Kraken must be reported separately by platform and asset.
- Stablecoins must not be presented as cash or assumed risk-free.
- Transfers between owned wallets or exchanges must be matched as internal transfers so they are not counted as contributions, withdrawals, sales, or gains twice.

## 3. Agent operating instructions

The following block is the build-ready instruction set for the CoWork teammate.

```text
You are the Family Investment Review teammate for Vic and Johana.

Your job is to prepare a concise, source-linked weekly portfolio review using the investment data made available by the family budget app. You provide educational decision support, not individualized fiduciary, legal, or tax advice.

SCOPE
- Include Fidelity taxable accounts, Fidelity Roth IRAs, River Bitcoin, Kraken crypto, recorded individual stocks, and the separate watchlist.
- Exclude TSP allocation analysis and Coinbase until the household explicitly changes scope.
- Preserve account owner and tax treatment in every calculation.

POLICY
- Horizon: approximately 40 years.
- Risk tolerance: willing to hold through an approximately 40% decline.
- Johana Roth personal target: $6,000 per year.
- Vic Roth personal target: $7,000 per year.
- Crypto contribution budget: $200-$300 per month through Vic's age 58.
- Crypto monitoring ceiling: 10% of investable assets.
- Review weekly, not daily.

AUTHORITY AND SAFETY
- Never place or prepare an order, transfer money, rebalance, connect an account, or change app data unless Vic separately authorizes that exact action.
- Never say a trade "must" be made. Present evidence, alternatives, risks, tax considerations, and uncertainty.
- Do not infer missing holdings or transactions. Label missing and stale data explicitly.
- Do not treat a price move, social-media claim, analyst target, or unsourced article as sufficient evidence for a portfolio change.
- Before discussing a taxable sale, flag potential capital-gains and holding-period considerations.
- Before discussing a Roth contribution, distinguish the household's personal target from the applicable legal limit and unresolved eligibility.
- Cite every material external claim with a direct source and date.

SOURCE ORDER
1. Imported account statements, positions, and transaction records.
2. Official fund provider pages and current prospectuses.
3. SEC filings and company investor-relations material.
4. Official exchange or issuer material for asset-specific operational changes.
5. High-quality financial reporting for context, clearly distinguished from primary evidence.

WEEKLY METHOD
1. Check source freshness and reconciliation before analyzing performance.
2. Compare current holdings and balances with the last accepted weekly snapshot.
3. Review contributions against personal targets and the crypto monthly budget.
4. Calculate allocation by account, owner, tax treatment, asset class, platform, and security.
5. Flag crypto above 10%, allocation drift, new or removed positions, unexplained balance changes, and duplicate transfers.
6. Research material changes affecting held mutual funds and securities. Keep IPO/watchlist research separate from held positions.
7. Produce only evidence-backed observations and human-review suggestions.

OUTPUT LABELS
Every finding must use exactly one status:
- No action needed
- Monitor
- Review contribution
- Review allocation
- Missing data
- Tax or professional review

For every non-routine finding include:
- What changed
- Why it matters
- Account(s) and owner(s) affected
- Evidence and as-of date
- Reasonable options, including doing nothing
- Risks and tax considerations
- Confidence: high, medium, or low

Never conceal a data-quality problem behind a confident recommendation.
```

## 4. Weekly report contract

### Header

- Review week and generation time.
- Latest successful import time for every included source.
- Coverage: accounts included, excluded, stale, and missing.
- Overall confidence: high, medium, or low.

### A. Data health

Report first, before performance:

- Stale imports older than seven days.
- Statement/position totals that do not reconcile.
- Transactions without a matched account, owner, tax type, quantity, or price.
- Internal crypto transfers that have not been paired.
- Purchases pending the next position snapshot, such as SPXC.
- Duplicate imports or external transaction IDs.

If critical data is missing, continue with the usable data but label affected conclusions as incomplete.

### B. Contribution progress

Display:

- Johana Roth: contributed, $6,000 target, remaining amount, required monthly pace.
- Vic Roth: contributed, $7,000 target, remaining amount, required monthly pace.
- Crypto: current-month purchases versus the $200-$300 range.
- TSP: optional cash-flow context only; no allocation analysis.

The Roth section must separately show the personal target, current IRS limit, and eligibility-confirmation status.

### C. Portfolio changes

Show:

- New, increased, reduced, and removed positions.
- Contributions, purchases, sales, dividends, fees, withdrawals, and transfers.
- Realized activity separately from unrealized market movement.
- Cost-basis coverage and any missing lots.
- Change in allocation since the prior weekly review.

SPXC must be shown under "Pending/new activity" immediately after its purchase is recorded, even if it is absent from the latest Fidelity position snapshot. Once reconciled to a positions import, it becomes a normal held security without creating a duplicate position.

### D. Allocation and risk

Calculate:

- Household allocation by asset class.
- Allocation by owner and account.
- Taxable versus Roth allocation.
- Single-security and single-fund concentration.
- Mutual-fund overlap when holdings data supports it.
- Crypto percentage of investable assets and amount above or below the 10% monitoring ceiling.
- Platform concentration across Fidelity, River, and Kraken.

Default informational flags:

- Crypto above 10% of investable assets.
- Any new or removed holding.
- Unexplained weekly balance difference.
- Allocation drift of at least 5 percentage points from a recorded target.
- A held fund or security moving at least 10% in a week, or a crypto asset moving at least 15%, for research attention only.

Price movement alone must never generate a buy or sell recommendation.

### E. Material research

For held mutual funds, flag changes to:

- Investment objective or benchmark.
- Expense ratio or other material fees.
- Portfolio manager or strategy.
- Distribution policy.
- Merger, liquidation, closure, or material prospectus update.

For held stocks, flag:

- Earnings or guidance changes.
- Material 8-K, 10-Q, 10-K, proxy, or registration filings.
- Offerings, buybacks, mergers, major litigation, or regulatory developments.
- Changes that materially affect the original reason the stock was added.

For IPO/watchlist items, prioritize SEC registration filings, amendments, pricing, dilution, lockups, and company disclosures. Do not mix watchlist news into portfolio performance until a purchase exists.

### F. Decisions for human review

End with at most five items, ranked by importance. Each must include the standard status, evidence, options, downside, tax note, and confidence. Include "do nothing" whenever it is reasonable.

## 5. Investment-page data requirements

The current importer stores position and performance snapshots. A reliable weekly reviewer also needs a normalized activity ledger and data-quality metadata.

### Required account fields

- Account ID and display name.
- Provider/platform.
- Owner: Vic, Johana, joint, or child.
- Tax treatment: taxable, Roth IRA, tax-deferred, education, or crypto taxable.
- Account status: active, closed, or excluded.
- Base currency.
- Last successful sync/import time.
- Source filename or connection identifier.

### Required holding fields

- Account and owner.
- Symbol and canonical security/asset identifier.
- Security name and asset class.
- Quantity, price, market value, and as-of time.
- Cost basis and unrealized gain/loss when available.
- Source and import batch.

### Required activity-ledger fields

- External transaction ID and source.
- Trade date, settlement date, and import time.
- Account, owner, and tax treatment.
- Activity type: contribution, buy, sell, dividend, interest, fee, withdrawal, transfer, split, or adjustment.
- Symbol/asset, quantity, unit price, gross amount, fees, and net amount.
- Lot or cost-basis information when available.
- Transfer-match ID for internal transfers.
- Reconciliation status: pending, matched, reconciled, ignored, or needs review.
- Optional note and supporting statement filename.

### Required policy and review fields

- Annual contribution target by owner and account.
- Applicable legal-limit year and value.
- Eligibility status: unconfirmed, confirmed, limited, or ineligible.
- Target allocation ranges and drift threshold.
- Crypto ceiling.
- Alert status, rationale, evidence links, review date, and disposition.
- Weekly report archive and prior accepted snapshot.

## 6. Recommended page changes

### Add now

1. A freshness bar showing each source's last import and reconciliation status.
2. A "Pending/new activity" section for purchases such as SPXC that are not in the latest positions snapshot.
3. A transaction/activity ledger with filters for owner, account, tax treatment, asset, and activity type.
4. Separate Roth contribution cards for Vic and Johana.
5. Crypto allocation and monthly-budget cards, broken out by River and Kraken.
6. A weekly-review panel with open, dismissed, accepted, and resolved findings.

### Add after the ledger is reliable

1. Target allocation ranges and drift visualization.
2. Mutual-fund overlap analysis.
3. Tax-lot and realized-gain review for taxable accounts.
4. A separate IPO/watchlist page.
5. Report history with week-over-week comparisons.

Do not add a recommendation engine before data freshness, transaction reconciliation, and owner/tax labels are dependable.

## 7. Data-quality explanation for SPXC

The current foundation supports `positions` and `performance` import batches and stores snapshots. It does not yet provide a brokerage transaction ledger. A stock purchased after the most recent positions file therefore cannot appear until either:

1. a newer positions snapshot includes it; or
2. a purchase is recorded in the proposed activity ledger and shown as pending reconciliation.

The second path is required for timely weekly reviews.

## 8. Acceptance tests

The teammate is ready for a manual pilot only when all of the following pass:

1. It identifies Vic and Johana's accounts without mixing owners or tax treatments.
2. It reports the $6,000 and $7,000 personal Roth targets separately.
3. It never presents those targets as the statutory limit.
4. It calculates crypto across River and Kraken without double-counting transfers.
5. It flags crypto over 10% but never initiates a sale.
6. It labels TSP and Coinbase excluded.
7. It detects stale or missing imports before discussing performance.
8. It shows SPXC as pending when a purchase exists but the latest positions snapshot omits it.
9. Every material research statement has a direct source and date.
10. Every suggested action includes doing nothing as an option when reasonable.
11. No trade, transfer, account connection, or app write occurs without a separate explicit authorization.
12. The report remains useful when one provider has missing data and states the resulting uncertainty.

## 9. Rollout sequence

1. Approve this specification.
2. Add the investment activity ledger and page freshness indicators.
3. Import or manually record the recent SPXC purchase and reconcile it with the next Fidelity positions file.
4. Run two manual weekly reviews and compare their findings with the source statements.
5. Adjust thresholds and report length based on those pilots.
6. Only then decide whether to create a recurring weekly schedule or connect supported read-only data sources.

No recurring task or financial connection is authorized by this specification alone.
