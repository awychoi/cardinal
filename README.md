<img src="docs/design/cardinal-lockup-dark-panel.svg" alt="Cardinal — local-first, encrypted wealth manager for macOS" width="320">

An open-source, local-first, encrypted wealth manager for macOS. It brings bank accounts and credit
cards into one quiet, bank-first balance sheet, tracks calendar-month spending, and keeps everything
on the Mac — no account, no cloud, no telemetry.

Built with Tauri 2, React, TypeScript, Rust, and SQLCipher.

![Cardinal overview in the Arcade theme, dark mode, showing net position, cash and card balances, a plain-language quick read, and upcoming card payments for synthetic demo data](docs/design/app-arcade-overview-dark.png)

## What it does

- A bank-first balance sheet: cash, card debt, available credit, and a net position that stay current regardless of the month you're viewing.
- A curated overview — net-position beam, plain-language quick read, payments coming up, category mix, and a 12-month trend — with exact row counts, utilization, and connection health one disclosure away.
- Calendar-month spending across credit cards and bank accounts, kept separate from statement cycles.
- An encrypted ledger, unlocked with a passphrase typed into a native macOS sheet - never stored.
- Plaid links both credit and depository (checking/savings) accounts. Manual bank accounts accept a point-in-time cash balance.
- One active Plaid Item per institution so duplicates are refused before wasting Trial items. **Update**/**Reconnect** reuses the existing Item for the same reason (Plaid caps Trial items to 10, not replenishable).

## Requirements

- macOS 13 or newer (developed and tested on Apple Silicon)
- Xcode Command Line Tools: `xcode-select --install`
- Rust stable via [rustup](https://rustup.rs)
- Node.js 22.12+ and pnpm 12 (`corepack enable` or `npm install -g pnpm`)
- Nothing else: SQLCipher is compiled in from the vendored crate

## Run it

```bash
git clone https://github.com/awychoi/cardinal.git
cd cardinal
pnpm install --frozen-lockfile
pnpm tauri dev
```

The first Rust build takes a few minutes; later launches are fast. The app opens locked: create a
vault with a passphrase, or choose **Open demo (synthetic data)** to look around without one.

## Build a macOS app

```bash
pnpm tauri:build
open src-tauri/target/release/bundle/macos/Cardinal.app
```

The display name and bundle are Cardinal. The bundle identifier remains
`com.awychoi.cardiganmoney`, and the Keychain service and backup seal keep their legacy values, so
existing vaults, backups and Keychain grants keep working.

The build is ad-hoc signed for local use only — not notarized, not App Sandboxed, not a
distributable release. macOS will ask once per Keychain item after each rebuild; every Plaid secret
lives in a single item, so that is one approval. If macOS complains about the signature, re-sign it
ad hoc:

```bash
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/Cardinal.app
```

## Tests

```bash
pnpm verify          # typecheck, lint, unit tests, production build
pnpm test:e2e        # Playwright; run `pnpm exec playwright install chromium` first
cd src-tauri && cargo test
```

## Secret scanning

The repository ships a [gitleaks](https://github.com/gitleaks/gitleaks) pre-commit hook and a
full-history CI scan. Enable the local hook once per clone:

```bash
git config core.hooksPath .githooks
```

It rejects staged credentials, the app's own vault, backup, and plaintext ledger-export artifacts,
and tracked key/credential files (`.env*` except `.env.example`, `.p8`/`.p12`/`.jks`/`.keystore`,
SSH private keys, `.netrc`, `.git-credentials`) even if force-added. CI
(`.github/workflows/secret-scan.yml`) re-scans all history on every push and weekly.

## Security notes

- **There is no passphrase recovery.** Lose the passphrase and every backup passphrase, and the
  data is unrecoverable.
- The ledger is encrypted at rest with SQLCipher; backups are encrypted containers. Plaintext CSV
  exports are not protected — the app warns before writing one.
- Plaid supports **Sandbox** test Items and **Trial/Production** real Items with separate
  credentials. The app allows one active Item per institution: if a bank is already connected, link
  completion stops before the access-token exchange and points to **Update**/**Reconnect** instead,
  so a duplicate cannot consume another Trial Item. Both environments are verified end to end:
  Sandbox on 2026-10-24 and Trial/Production on 2026-11-01 with a real production Item (4 credit
  accounts). Depository accounts are implemented and covered by the test suite, but the live
  verification Items contained credit accounts only. Live reconnect/update mode has not been
  exercised against a real Item, and Trial limits and billing apply. The app is not affiliated with
  Plaid.
- The UI never receives the passphrase or provider tokens; those stay in Rust and the macOS
  Keychain.
- Read [SECURITY.md](SECURITY.md) before relying on this for real data.

## User guides

- [Documentation map](docs/README.md)
- [Architecture overview](ARCHITECTURE.md)
- [Plaid setup and linking](docs/integrations/plaid-guide.md)
- [Backup and recovery](docs/operations/backup-recovery.md)
- [Security architecture](docs/security/architecture.md) · [threat model](docs/security/threat-model.md) · [incident runbook](docs/security/incident-runbook.md)

## Status

Early and experimental. Interfaces, storage formats, and behavior can change. Plaid linking is
verified in both Sandbox and Trial/Production — the production path with a real production Item
(4 credit accounts, 2026-11-01); depository-account linking is not yet live-verified. Live
reconnect/update mode remains unverified. The macOS build is ad-hoc signed and not
distribution-ready.

## License

Copyright 2026 awychoi.

Licensed under the [Apache License, Version 2.0](LICENSE). You may use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies, including commercially, provided you give
recipients a copy of the license, mark modified files, and retain the copyright, patent,
trademark, and attribution notices that apply. The license includes an express patent grant and
does not grant permission to use the project's trademarks.

The software is provided **as is, without warranties or conditions of any kind**, express or
implied, and you use it **at your own risk**. Keep your own backups; the author is not liable for
lost data, forgotten passphrases, or incorrect financial figures.

## About this project

This is a fun experimental agentic AI workflow project, made by
[Wai Yin Choi](https://wychoi.com). It will keep being worked on and experimented with — expect
rough edges, changing directions, and new ideas over time.
