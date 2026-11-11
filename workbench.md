---
treatment: hero
order: 20
kicker: Private · Serverless
banner: docs/design/app-arcade-overview-dark.png
banner_alt: Cardinal overview in the Arcade theme, showing net spending, reported payments, and card balances for synthetic demo data.
logo: src/assets/brand/cardinal-lockup-dark.svg
logo_light: src/assets/brand/cardinal-lockup.svg
meta:
  - label: The experiment
    value: Reduce attack surface by architecture - no server, accounts, telemetry, or remote code. No retained passphrase, no recovery backdoor.
  - label: What I learned
    value: A local-first security model is mostly a set of refusals; every convenience has to earn its place.
link:
  href: https://github.com/awychoi/cardinal
---

## What it is

Cardinal consolidates a person's credit-card balances and transactions into one Plaid-synced dashboard. Or keep it offline via CSV import or manual entry.

The vault is SQLCipher-encrypted; an Argon2id-derived key wraps the data key behind a passphrase that is never stored — irrecoverable, by design. Plaid secures the bank connections. Secrets live in the macOS Keychain.