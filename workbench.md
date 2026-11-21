---
treatment: hero
order: 20
kicker: Private · Serverless
note: >-
  I didn't want to hand over my private financial data, so I built my own wealth tracker. I use
  credit cards 99% of the time, but a real picture needs the bank side too.
banner: docs/design/app-arcade-overview-dark.png
banner_alt: >-
  Cardinal overview in the Arcade theme, showing net position, cash and card balances, a
  plain-language quick read, and upcoming payments for synthetic demo data.
logo: src/assets/brand/cardinal-lockup-dark.svg
logo_light: src/assets/brand/cardinal-lockup.svg
back_focal: 27% 34%
back_zoom: 1.45
link:
  href: https://github.com/awychoi/cardinal
---
## What it is

Cardinal brings bank accounts and credit cards into one bank-first balance sheet, with cash and card spending.
Calendar-month spending stays distinct from statement cycles; amounts can sync through Plaid, import from CSV, or be entered manually. No more accounts, cloud, or telemetry (besides the optional Plaid).

The vault is SQLCipher-encrypted; an Argon2id-derived key wraps the data key behind a passphrase that
is never stored, hence irrecoverable, by design. Optional Plaid credentials live in the macOS Keychain, and the renderer never receives them.