---
treatment: hero
order: 20
kicker: Private · Serverless
note: >-
  I didn't want to hand over my private spending data, so I built my own expense tracker. Since I
  use credit cards 99% of the time, a Plaid trial made total sense.
banner: docs/design/app-arcade-overview-dark.png
banner_alt: >-
  Cardinal overview in the Arcade theme, showing net spending, reported payments, and card balances
  for synthetic demo data.
logo: src/assets/brand/cardinal-lockup-dark.svg
logo_light: src/assets/brand/cardinal-lockup.svg
back_focal: 27% 34%
back_zoom: 1.45
link:
  href: https://github.com/awychoi/cardinal
---
## What it is

Cardinal consolidates a person's credit-card balances and transactions into one Plaid-synced dashboard. Or keep it offline via CSV import or manual entry.

The vault is SQLCipher-encrypted; an Argon2id-derived key wraps the data key behind a passphrase that is never stored — irrecoverable, by design. Plaid secures the bank connections. Secrets live in the macOS Keychain.