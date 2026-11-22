<img src="docs/design/cardinal-lockup-dark-panel.svg" alt="Cardinal — local-first, encrypted wealth manager for macOS" width="320">

An open-source, local-first, encrypted wealth manager for macOS. It brings bank accounts and credit
cards into one quiet, bank-first balance sheet, tracks calendar-month spending, and keeps everything
on the Mac — no account, no cloud, no telemetry.

Built with Tauri 2, React, TypeScript, Rust, and SQLCipher.

Early and experimental: interfaces and storage formats can change.

![Cardinal overview in the Arcade theme, dark mode, showing net position, cash and card balances, a plain-language quick read, and upcoming card payments for synthetic demo data](docs/design/app-arcade-overview-dark.png)

## What it does

- A bank-first balance sheet: cash, card debt, available credit, and a net position that stay current
  regardless of the month you're viewing.
- A curated overview — net-position beam, plain-language quick read, payments coming up, category
  mix, and a 12-month trend — with exact row counts, utilization, and connection health one
  disclosure away.
- Calendar-month spending across credit cards and bank accounts, kept separate from statement cycles.
- An encrypted ledger, unlocked with a passphrase typed into a native macOS sheet — never stored.
- Plaid links credit and depository accounts. Manual bank accounts accept a point-in-time cash
  balance.
- One active Plaid Item per institution, so a duplicate cannot consume another Trial Item.
  **Update**/**Reconnect** reuses the existing Item.

## Requirements

- macOS 13 or newer (developed on Apple Silicon)
- Xcode Command Line Tools: `xcode-select --install`
- Rust stable via [rustup](https://rustup.rs)
- Node.js 22.12+ and pnpm 12 (`corepack enable`)
- SQLCipher is compiled in from the vendored crate; nothing else to install

## Run it

```bash
git clone https://github.com/awychoi/cardinal.git
cd cardinal
pnpm install --frozen-lockfile
pnpm tauri dev
```

The first Rust build takes a few minutes. The app opens locked: create a vault, or choose **Open demo
(synthetic data)** to look around.

## Build a macOS app

```bash
pnpm tauri:build
open src-tauri/target/release/bundle/macos/Cardinal.app
```

The bundle identifier is `com.awychoi.cardinal`, and backups from before the rename remain
restorable.

This is a local build, not a distribution: the executable is linker-signed ad hoc and the `.app` is
not bundle-signed, notarized, or sandboxed. Sign it with `scripts/local-signing.sh` for a stable local
identity, or re-sign ad hoc:

```bash
codesign --force --deep --sign - src-tauri/target/release/bundle/macos/Cardinal.app
```

## Tests

```bash
pnpm verify          # typecheck, lint, unit tests, production build
pnpm test:e2e        # Playwright; run `pnpm exec playwright install chromium` first
cd src-tauri && cargo test
```

Enable the repository's secret-scanning hook once per clone:
`git config core.hooksPath .githooks`.

## Security notes

- **There is no passphrase recovery.** Lose the passphrase and every backup passphrase, and the data
  is unrecoverable.
- The ledger is encrypted at rest with SQLCipher; backups are encrypted containers. Plaintext CSV
  exports are not protected — the app warns before writing one.
- The UI never receives the passphrase or provider tokens; those stay in Rust and the macOS Keychain.
- Read [SECURITY.md](SECURITY.md) before relying on this for real data.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture overview](ARCHITECTURE.md)
- [Plaid setup and linking](docs/plaid.md)
- [Backup and recovery](docs/backups.md)

## License

Copyright 2026 awychoi. Licensed under the [Apache License, Version 2.0](LICENSE).

The software is provided **as is, without warranties of any kind**, and you use it **at your own
risk**. Keep your own backups; the author is not liable for lost data, forgotten passphrases, or
incorrect financial figures.

## About this project

A fun experimental agentic AI workflow project by [Wai Yin Choi](https://wychoi.com). Expect rough
edges, changing directions, and new ideas over time.
