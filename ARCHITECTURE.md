# Architecture: Cardinal

A technical tour of Cardinal: the process boundary, the encryption and storage model, how provider
credentials move, and what backups and restores do. For protections and residual risks, read
[SECURITY.md](SECURITY.md).

## Process and trust boundaries

Cardinal is a Tauri 2 app: a React/TypeScript renderer in a WebView, a Rust core, and a SQLCipher
ledger.

```text
React/TypeScript renderer (untrusted) ── typed IPC gateway ── Rust core (trusted) ── SQLCipher ledger
no network, filesystem, SQL, or Keychain      one command, typed payloads      keys, provider, backups
```

- The renderer receives formatted data, never the passphrase, data key, provider tokens, client
  secret, raw provider payloads, or filesystem paths.
- Secrets are collected in native AppKit secure sheets. The renderer sees only success, failure, or
  cancellation.
- One Tauri capability and one gateway command. New windows and navigation are blocked, and the CSP
  allows no remote asset origin.
- The frontend contract is validated twice: Rust deserializes with `deny_unknown_fields`, and the
  TypeScript client parses every response with Zod.

## Vault and storage

- A random 256-bit data encryption key (DEK) is the SQLCipher raw key.
- An Argon2id key-encryption key (KEK) derives from the passphrase and wraps the DEK with
  XChaCha20-Poly1305.
- KDF parameters, salt, wrapped DEK, vault ID, and generation live in an authenticated `vault.header`
  plus mirror. The header is bound as AEAD associated data.
- The app fails closed if SQLCipher is not active or an integrity check fails. There is no plaintext
  fallback, and the passphrase is never stored.
- The database uses STRICT tables and forward-only, checksummed migrations. A pre-migration encrypted
  snapshot is written before a non-empty ledger migrates.
- Domain tables cover accounts, transactions, overrides, merchant rules, balance and payment
  snapshots, import batches, sync runs, connections, security events, and settings.
- Accounts are credit products or depository accounts (checking, savings, or a generic fallback).
  Card debt and cash are tracked separately: `BalanceTotals` derives the net position as cash minus
  card debt, and a missing balance marks the position incomplete rather than treating it as $0.00.
- Restored provider snapshots carry a `restored` flag so a rollback never looks like fresh bank data.
- Demo mode is a separate database and code path with a fixed synthetic key; it cannot open the real
  ledger.

## Plaid lifecycle

Provider secrets live in the macOS login Keychain: one slot per environment for the client ID and
secret, and one access token per linked Item. The ledger stores only an opaque `credential_ref`.

1. Rust creates a Hosted Link session and opens it in the system browser. No custom scheme, loopback
   listener, or callback is used.
2. The app polls `/link/token/get`. Before exchanging the public token, it refuses an institution
   that already has an active Item in that environment, so a duplicate cannot consume a Plaid Item.
3. On success, the access token goes to the Keychain under a fresh reference and the ledger records
   the environment, institution, status, and cursor.
4. Sync runs in Rust after unlock, advances the cursor only after the page commits, and maps credit
   and depository accounts. A re-authentication error demotes the connection to
   `reconnect_required`; other failures record a sanitized error.
5. **Update/Reconnect** uses Plaid update mode with the stored token and keeps the same Item.
6. A connection without a local token offers **Link again…**, which creates a new Item.

Scheduled sync targets 08:00 and 20:00 local time and never runs while the vault is locked.
Connections are `healthy`, `reconnect_required`, `error`, or `disconnected`. See
[docs/plaid.md](docs/plaid.md) for setup and limits.

## Backups and restore

A backup is a self-contained encrypted container (`.cmbak`): a SQLCipher snapshot plus the
authenticated header that carries the wrapped DEK. Kinds are daily, manual, pre-migration,
pre-restore, and pre-change. Retention keeps 7 daily, 10 manual, and 5 of each pre-change kind,
never the last remaining backup.

Restore is staged: copy, decrypt, migrate, rewrite, and fully validate before the live vault is
touched. Scopes are full database, financial data + settings, and financial data only; partial
scopes reset connections. Cross-vault and fresh restores may adopt the backup's vault identity and
passphrase. A destructive full-database path exists for a locked vault whose passphrase is lost.

After a restore, restored transaction history stays visible, but live provider balances, credit
values, limits, and due metadata are hidden until fresh data arrives. Connections clear their
cursors and resync. A restored connection whose token is still in this Mac's Keychain reuses its
Plaid Item; otherwise it needs a new link. Tokens never travel in backups. See
[docs/backups.md](docs/backups.md) for the user flow.

## Network and data handling

- Outbound access is limited to Plaid's two documented hosts. Requests are TLS-only, size capped,
  redirect-free, and parsed as untrusted input.
- CSV import is a Rust-owned streaming job. The renderer receives an opaque job ID, counts, and
  preview rows, never a path. Limits are 20 MiB, 100,000 rows, 40 columns, and 4,096 characters per
  field.
- CSV export writes plaintext to a user-chosen location after an explicit warning, with owner-only
  permissions and formula-injection escaping.
- Logging is off by default. Release logging is redacted lifecycle/security metadata only.

## Build and tests

```sh
. ./scripts/dev-env.sh   # sandbox-local Rust and package caches
pnpm verify              # typecheck, lint, Vitest, production web build
pnpm verify:all          # adds format check, Playwright, cargo fmt/clippy/test
pnpm tauri build         # macOS app, then ad-hoc sign and record SHA-256
```

- Rust integration tests in `src-tauri/tests/`.
- Vitest tests in `src/`.
- Playwright browser tests against the mock bridge only; they prove UI behavior, not native behavior.
- Scripted checks reject plain SQLite and scan release artifacts.

## Further reading

- [SECURITY.md](SECURITY.md) — protections, residual risks, incident response.
- [docs/plaid.md](docs/plaid.md) — Plaid setup, linking, reconnect, and limits.
- [docs/backups.md](docs/backups.md) — backup, restore, and recovery.
- [docs/README.md](docs/README.md) — documentation index.
