# Security: Cardinal

Cardinal is a local, single-user, encrypted macOS app with no server, account service, or telemetry.
This page states what it protects, what it does not, and what to do if something goes wrong.

**Not distribution-ready.** The executable is linker-signed ad hoc, the app bundle is not signed or
notarized, and there is no hardened runtime or App Sandbox. Use it on a Mac you control, with
FileVault on.

## What protects the data

| Control | Implementation |
| --- | --- |
| Encryption at rest | SQLCipher with a random 256-bit key; the database and WAL are ciphertext |
| Key handling | An Argon2id-derived KEK wraps the data key with XChaCha20-Poly1305; the wrapped key and KDF metadata live in an authenticated header outside the database |
| Passphrase | Collected in a native AppKit secure sheet; never stored, logged, sent over IPC, or shown to the renderer |
| Renderer boundary | One window, one capability, one typed command gateway, strict CSP with no remote sources, blocked navigation and new windows; the renderer is treated as untrusted |
| Lock | Manual lock, screen lock, sleep, fast user switching, quit, and an idle timeout close the database and zeroize the key. Clearing the visible screen depends on a renderer event and is best effort. |
| Provider secrets | Plaid client credentials and Item tokens live in the login Keychain, never in the ledger, backups, exports, logs, or renderer. The login Keychain's lock state and the code-signature ACL are the effective protection; the `WhenUnlockedThisDeviceOnly` attribute is set but is not what protects the item. |
| Backups | Self-contained encrypted containers with their own header; restore always asks for the passphrase |
| Files | `0700` directories, `0600` files, symlink rejection, atomic writes |
| Network | Rust-only client with TLS verification, HTTPS only, no redirects, an exact Plaid host allowlist, and response caps; the renderer has no network source |
| Audit trail | Encrypted security events for unlock failures, lock, backup, restore, export, rekey, and credential changes. Owner monitoring only; not tamper-evident, and not every declared event type is emitted. |
| Repository hygiene | gitleaks pre-commit hook and full-history CI; app vault, backup, export, and key/credential patterns are refused even if force-added; some internal rotation artifacts are not yet covered |

## What it does not protect

- A compromised macOS account, root or kernel attacker, or malware running as you can read the
  unlocked process and its files. `mlock` and zeroization are best effort.
- Screen capture is not preventable. Content protection is best effort and can be bypassed by modern
  capture tools, cameras, or remote-support software.
- A weak or reused passphrase defeats Argon2id. A lost passphrase cannot be recovered.
- Old backups and old key material remain decryptable with the old passphrase after a rotation until
  you delete them.
- Plaintext CSV exports and copies outside the app are unprotected.
- A compromised renderer can invoke allowed commands, read data already displayed, and ask you to
  unlock. Native input prevents silent passphrase capture, not post-unlock abuse.
- A compromised Plaid or bank, physical memory attacks, a coerced owner, and macOS/WebKit zero-days
  are out of scope.
- TLS uses bundled roots, not the macOS trust store, and has no certificate pinning. A full rollback
  of both the header and database is not detectable.
- Hosted Link places a short-lived bearer URL in your browser; browser history and extensions are
  outside the app's control.
- Crypto-erasure is logical, not physical. SSD copies and external backups remain.
- There is no auto-update, notarization, hardened runtime, App Sandbox, hardware-backed key, Touch ID
  unlock, or MFA.
- The default build is not bundle-signed; `codesign --verify --deep --strict` fails until you sign it.

## Reporting a security issue

Report privately to the owner through the same trusted channel used for the app. Do not open a public
issue containing ledger data or credentials. Never send the passphrase, a backup, an exported CSV, an
access token, or the Plaid client secret. There is no bug bounty and no guaranteed response time.

## If something goes wrong

### Passphrase may be compromised

1. Unlock and use **Settings → Lock & idle → Change passphrase…**. This creates a new data key,
   rekeys the live database, and writes a new header.
2. Confirm the old passphrase now fails, then make a fresh encrypted backup.
3. Delete old backups that still open with the old passphrase, plus the vault directory's
   `pre-rekey-*` files and older `pre-migration-*` snapshots. Rotation does not remove them.
4. Treat any plaintext CSV exports as compromised and delete them.
5. If Plaid is connected, revoke the affected Items in the Plaid dashboard, relink, and rotate the
   client secret.
6. Review recent security events in Settings.

### Token or client secret leaked

1. Disconnect the provider in the app, or use **Remove all provider credentials**.
2. Revoke the Item or rotate the client secret in the Plaid dashboard.
3. Relink with fresh credentials. The offline ledger remains usable.

### Mac or backup lost or stolen

1. Rely on FileVault and the vault passphrase for data at rest. The app cannot wipe the device
   remotely.
2. Revoke Plaid Items from another device and change the vault passphrase when you regain access.
3. Assume any unlocked session was exposed. Treat a stolen backup or plaintext export as compromised:
   rotate the passphrase and delete old backups. A CSV export requires account monitoring.

### Passphrase lost

There is no recovery. A self-contained backup restores access only if its passphrase is known. No
reset, escrow, support override, or hidden account exists.

### Database corrupt or unlock fails

1. Do not run repair tools on the only copy. Preserve the vault directory.
2. Restore the newest verified backup. If the app cannot unlock, use **Restore from backup…** on the
   locked gate.
3. If both header copies are lost, the ledger cannot be opened in place even if the database
   survives. Restore a self-contained backup; a fresh install can create a vault directly from it.

### App crashes on launch

Preserve the app data and check the local console for non-sensitive messages. Rebuild from the
recorded source and SHA-256. Do not disable vault checks or run a modified binary.

### Restore or rotation failed

A failed restore leaves the live ledger untouched by design; use the `pre-restore` backup if a
post-swap failure is reported. A failed rotation has a journal and a `pre-change` backup: try the new
passphrase if the rekey completed, otherwise the old one, then restore the backup. Do not edit or
delete the journal by hand before trying unlock.

### Compromised dependency or build

Stop using the artifact. Rebuild from a clean checkout with the lockfiles, run `cargo audit`,
`cargo deny check`, and `pnpm audit`, and compare the new SHA-256. Rotate the vault passphrase and
provider credentials.

## Operational expectations

- Keep macOS and the Xcode command-line tools patched.
- Enable FileVault and a short screen-lock timeout.
- Keep the passphrase in a password manager, not in chat, the repository, an environment file, or
  notes stored with backups.
- Use **Lock Now** before leaving. Hiding the window is not a lock.
- Verify the artifact SHA-256 before running a rebuilt app.

## Verification

The security claims are backed by Rust integration tests and browser tests where applicable. Browser
tests do not prove native Tauri or macOS behavior; native sheets, Keychain prompts, screen lock, and
sleep should be checked on the machine you use.
