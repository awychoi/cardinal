# Wealth interface: design notes

The app began as a credit-card ledger. Bank accounts were added to the data model but surfaced as
a small second section below the cards. This redesign turns the product into a bank-first wealth
manager: the balance sheet leads, spending becomes a supporting rhythm, and the deeper numbers are
available without crowding the default view.

The brand lockup, wordmark, and bird mark are unchanged. Everything around them — information
architecture, type scale, colour application, layouts, charts, and copy — was reconsidered.

## Direction: a quiet almanac, not a banking dashboard

- **Warm paper, cardinal ink.** The default theme is **Almanac** (theme id `blueprint`, kept stable
  for saved preferences and the Rust default). Cream paper, warm near-black ink, a cardinal-red
  pencil, and a serif display face give the app a printed-almanac character rather than a generic
  fintech surface.
- **One expressive moment.** The theme-reactive **A quick read** card is deliberately the loudest
  object on the page. Warm paper with an accent edge in light mode, an ink-like surface in dark
  mode. It translates the numbers into plain language instead of adding another table.
- **Bank accounts as first-class.** Cash has its own colour, iconography, passbook-like tiles, and
  a place above cards. Cards remain fully represented, but they are the borrowed side of the same
  balance sheet, not the whole product.
- **Curated by default, exact on demand.** The first screen shows only the signals needed to answer
  “how am I doing?”. Utilization, row counts, connection health, currencies, and full account
  tables live behind **The deeper picture**.

## Information architecture

| View | Job |
| --- | --- |
| **Overview** | Net position, cash/debt split, a short derived read, account glimpse, upcoming payments, category mix, and a 12-month trend. |
| **Accounts** | A balance sheet: cash accounts first, then credit accounts, followed by optional full tables. |
| **Transactions** | The complete mixed-account ledger with currency-aware subtotals, editing, and drill-down. |
| **Settings** | Appearance, accounts and connections, backups, merchant rules, lock behaviour, and the security record. |

The month control is a *spending month*, not a balance month. Balances are current; only the
spending, category, trend, and ledger views move with the selected month.

## Signature components

### Net position + balance beam

`netPositionMinor` is the hero. Cash sits on the green side and card balances on the red side of a
single beam, so the net figure has a shape rather than being a number without context. Missing
balances never become zero: the headline and sides show **Not reported** instead.

### A quick read

A small set of derived sentences (cash cushion, card debt versus cash, upcoming payments, pace,
top category) using only figures already on the dashboard. It is labeled as an estimate, not
financial advice. The card follows the selected theme and mode: warm paper in light mode, an
elevated ink surface in dark mode, always with a cardinal accent edge.

### Coming up

A 14-day rail plus a list of known card payments. The total is explicitly **USD known minimums**;
unknown amounts stay visible, and every payment behind the total can be revealed with **Show all**.
A cash-after-known-amounts estimate makes the timing consequence explicit.

### Bank-first balance sheet

Accounts leads with **Bank accounts** and a green-edged passbook tile: account name, cash balance,
freshness, net spending after refunds, and whether it is included in the USD totals. Credit cards
follow as a separate borrowed side with limit, utilization, due date, and manual/provider source.
Other currencies are shown but never summed into USD totals.

### The deeper picture

A native `<details>` disclosure contains the full attention list, credit utilization, and the exact
month arithmetic (purchases, refunds, fees/interest, pending, eligible/all row counts). Full account
tables are a second disclosure on the Accounts view. This is the “ask for more” layer, not a second
dashboard.

## Data honesty rules

- **Backend owns totals.** Presentation code formats and derives context, but monthly spending,
  balances, and net position come from Rust.
- **Unknown is not zero.** Missing balances and due amounts print “Not reported”; a reported `$0.00`
  remains a real value.
- **Currencies never mix.** USD totals are labeled as such, and other currencies are shown
  separately. The ledger subtotals and report scopes are explicit.
- **Counts have scopes.** “Eligible rows · USD” and “All rows · all currencies” are different
  things, and the interface says which one it is showing.
- **Current is not selected.** The selected month changes spending views only. Past months are not
  called “so far.”
- **No fake precision.** Cash cushion and pace are labeled estimates based on posted activity; a
  month with no ledger rows is “No data,” not a confirmed zero.
- **Warnings can be dismissed without hiding the data.** A missing-balance warning can be dismissed
  for the session (and restored from the deeper picture); the account itself still shows
  “Not reported” so the underlying state remains visible.

## Accessibility

- Keyboard-first: skip link, focus moved to the destination on view changes, per-row transaction
  detail buttons, focus restoration on close, Escape handling, and a labelled detail region.
- Native disclosures and tables preserve expected semantics; charts carry exact hidden tables.
- Account tiles pair short names with screen-reader descriptions of balance, due date, status, and
  inclusion.
- Focus is never hidden under a sticky header; the ledger scroll-padding and sticky filter offsets
  account for it.
- Reduced-motion preferences and the theme's calm mode disable nonessential transitions and smooth
  scrolling.

## Themes and capture

Five themes ship: **Almanac** (default), **Arcade**, **Editorial**, **Graphite**, and **Ledger**.
They share the structure and change colour, type, radius, density, and motion. Theme ids remain
stable (`blueprint` is Almanac) so existing saved preferences keep working.

The README screenshot is `docs/design/app-almanac-overview-dark.png` (1600 × 1074, Almanac dark);
the workbench banner is `docs/design/app-arcade-overview-dark.png` (same size, Arcade dark). Both
use the synthetic demo ledger. Capture with `VITE_MOCK_BRIDGE=1 pnpm dev`, hide the browser-only
mock-bridge banner, and do not include real vault data.
