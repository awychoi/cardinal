# Cardinal security assessment — 2026-11-21

## 1. Executive summary

Cardinal is **substantially better engineered than a typical local-first personal finance app**.
Its core at-rest story is real: a random 256-bit data key is wrapped with an Argon2id-derived key,
the database is SQLCipher, open failures are fail-closed, file permissions are enforced, backups
are authenticated, and the renderer has no filesystem or network capability. The token, passphrase,
and IPC boundaries are not marketing-only; they are implemented in Rust and covered by tests.

It is **not** "secure" in an absolute sense, and several controls are weaker than the documentation
or UI implies. The most important gaps are:

1. **The built app bundle is not validly code-signed, and it has no hardened runtime.** The main
   executable is linker-signed ad-hoc, but `codesign --verify --deep --strict` and `spctl` reject
   the bundle. `Info.plist` is not bound and resources are not sealed. This is the largest gap for
   a finance app on a machine that can run local malware.
2. **The Keychain accessibility claim is not effective.** The Plaid item lives in the login
   (file-based) Keychain; `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` is set but—as the app's own
   architecture document admits—does not provide the property the UI and `SECURITY.md` imply.
   A single item also holds every provider secret.
3. **Passphrase rotation does not retire old key material.** A successful rotation deliberately
   leaves `pre-rekey-*.cmdb` and `pre-rekey-*.vault-header` in the vault directory, plus old
   backups. The old passphrase therefore still opens hidden copies after "changing the passphrase".
4. **Manual/auto lock clears the Rust session, but clearing the visible screen depends on a
   best-effort renderer event.** The database is inaccessible, but cached ledger content can remain
   on screen if the event is missed, and the JS heap is not cleared.
5. **The unlock rate limiter is mostly inconvenience.** It is in-memory, resets on relaunch, counts
   cancelled prompts, and does nothing against an offline attacker. Argon2id and passphrase entropy
   are the real defenses.

The practical verdict: for a **single-user personal Mac**, with FileVault on, a strong unique
passphrase, encrypted backups, and the screen locked when away, the design is reasonable and the
at-rest protection is credible. It is **not suitable for a shared Mac, a high-target environment,
or a machine with untrusted local software** until the signing/build-integrity and old-key-material
issues are addressed. It is also explicitly not distribution-ready.

## 2. Scope and method

Reviewed at commit `1b7a010`:

- vault crypto, header format, rotation journal, KDF policy, SQLCipher setup and integrity checks;
- lock lifecycle and native dialogs;
- Keychain storage, Plaid token flow, backups/restore, CSV import/export, filesystem handling;
- Tauri configuration, capabilities, CSP, IPC gateway and renderer boundary;
- build artifact, signing, entitlements, dependency advisories, and repository secret hygiene.

Evidence gathered:

- `pnpm test` — 178 tests passed;
- `cargo test --lib security::` — 29 tests passed;
- `codesign -dvvv`, `codesign --verify --deep --strict`, and `spctl --assess` against the built
  `Cardinal.app`;
- `cargo audit` and `pnpm audit`;
- source and documentation review.

No destructive native tests were run. The native AppKit sheet, Keychain ACL prompts, sleep/screen
lock notifications, ScreenCaptureKit behavior, and Gatekeeper launch behavior were assessed from
code and public platform behavior, not exercised interactively on this machine.

## 3. What is genuinely effective

| Control | Why it is real | Important limit |
|---|---|---|
| SQLCipher at rest | Raw 256-bit DEK passed as `PRAGMA key = "x'…'"`; database and WAL are ciphertext; `cipher_version`, keyed read, and `cipher_integrity_check` must pass | An unlocked process or a compromised macOS account can read decrypted pages |
| Argon2id key wrapping | 64 MiB default, calibrated to ~350 ms, bounded before derivation; KEK wraps the DEK with XChaCha20-Poly1305 | A weak/reused passphrase still defeats it; memory-hard but not magic |
| Authenticated header | Public header bytes are AEAD associated data; every byte is tested for tamper detection; KDF bounds are validated before Argon2 | Header+DB rollback to an older consistent pair is not detectable |
| Fail-closed open | Existing DB is never opened with `CREATE`; plaintext SQLite header is rejected; wrong key and tampered header fail closed | Denial of service remains possible by corrupting files |
| Backups | Self-contained container with embedded header, sealed manifest, DB SHA-256, staged restore, schema allow-list, rekey to a fresh key for custom passphrases | Old backups stay decryptable with the old passphrase; tokens are not in the container |
| Native secure input | `NSSecureTextField` in a native `NSAlert`; renderer receives only success/failure; Secure Event Input blocks ordinary keyloggers | Malware with Accessibility/Input Monitoring or a compromised OS can still capture input |
| Renderer boundary | One custom `gateway` command, typed payloads, one capability, CSP with no HTTPS source, no remote assets, blocked navigation/new windows, devtools off, no renderer network | A compromised renderer can still invoke allowed commands and read the decrypted data it already displays |
| File discipline | 0700 directories, 0600 files, symlink rejection, atomic writes, no-follow backup opens, umask 077, core dumps disabled | Same-user malware can still read the process; TOCTOU is possible in principle |
| Secret handling | Passphrase and Plaid secrets stay in Rust; no Debug/Serialize on secret types; redacting logger off by default; secret-shaped event keys dropped | Zeroization and `mlock` are best-effort and incomplete, as described below |
| Audit events | Encrypted event log records unlock failures (on next success), lock, backup, restore success, export, rekey, credential changes | Not tamper-evident; several declared event types are never emitted |
| Repository hygiene | gitleaks pre-commit/full-history CI, pinned gitleaks, dependency lockfiles, `ignore-scripts`, allow-list postinstall | CI does not run dependency audits; some app-generated artifact patterns are missing |

These are not "security theater." They materially raise the cost of the realistic threats: stolen
disk, stolen backup, casual local access, a compromised webview, and accidental plaintext leakage.

## 4. Findings: ineffective, overstated, or poor value

### F1 — High — the app bundle is not validly signed, and there is no hardened runtime

**Evidence**

`codesign -dvvv` on the built bundle reports:

```text
CodeDirectory ... flags=0x20002(adhoc,linker-signed)
Signature=adhoc
Info.plist=not bound
Sealed Resources=none
TeamIdentifier=not set
```

There is no `Contents/_CodeSignature` directory. Verification fails:

```text
$ codesign --verify --deep --strict Cardinal.app
Cardinal.app: code has no resources but signature indicates they must be present
$ spctl --assess --type execute Cardinal.app
... code has no resources but signature indicates they must be present
```

The Mach-O executable is linker-signed ad-hoc (the arm64 linker requires some signature), but the
**app bundle is not signed and its resources/metadata are not sealed**. There is no hardened-runtime
flag (`runtime` would appear in the flags), no App Sandbox, and no notarization.

**Why it matters**

- At review time, the README said "The build is ad-hoc signed for local use only"; that was true
  of the executable, but not of the bundle. The README has since been corrected.
- A downloaded or quarantined copy fails Gatekeeper; a locally built copy only launches because it
  was never quarantined.
- Without a bundle seal, `Info.plist` and resources are not integrity-protected. Adding, for
  example, an `LSEnvironment` entry to inject a dynamic library is a local code-injection path that
  a properly signed/hardened app does not have.
- Without hardened runtime, library validation and modern injection protections are absent.
- The Keychain ACL is tied to the ad-hoc code identity, which changes on every rebuild. That is the
  direct cause of the "one approval after each rebuild" inconvenience. Consolidating all secrets
  into one Keychain item reduces the prompt count, but it does not fix the identity churn.

**Recommendation**

Sign the bundle as part of the build (Tauri signing identity `-` for ad-hoc, or the repository's
self-signed identity via `scripts/local-signing.sh`), then verify with `codesign --verify --deep
--strict`. Enable hardened runtime if the toolchain permits it. If using `local-signing.sh`, note
that its stable private key lives in the login keychain and is trusted by `codesign`; anything that
can invoke `codesign` with that identity can produce a matching app. That is a deliberate tradeoff
against prompt churn, not a free security win.

### F2 — Medium — the Keychain "WhenUnlockedThisDeviceOnly" claim is not effective

**Evidence**

`src-tauri/src/security/keychain.rs:393-397` sets
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` on creation. It does **not** set
`kSecUseDataProtectionKeychain`, and the app has no Keychain access-group entitlement. The app's own
architecture document says so explicitly:

> The item lives in the login (file-based) Keychain — the build does not request the data-protection
> Keychain (`kSecUseDataProtectionKeychain`), so the accessibility class is not what protects it:
> the login keychain's lock state is.

Despite that, at the time of review `SECURITY.md` listed
`WhenUnlockedThisDeviceOnly` as a control, and the native Plaid sheet told the user the credentials
were stored "only in the macOS Keychain (WhenUnlockedThisDeviceOnly, not synchronized)". Both were
corrected in the documentation pass that accompanies this report; the underlying Keychain design is
unchanged.

**Why it matters**

- The real protection is the login keychain lock state plus the code-signature ACL. "This device
  only" backup-exclusion semantics should not be assumed for a file-based login keychain item.
  Depending on the user's Time Machine/keychain configuration, the item may be part of ordinary
  macOS backups in a way the app does not control.
- One item contains the Sandbox and Production client secrets and every access token. One "Always
  Allow" grant therefore exposes all provider credentials at once. This is convenient, but it is not
  a security improvement over per-item grants; it is a deliberate blast-radius tradeoff.
- With the current ad-hoc signature, "Always Allow" does not survive a rebuild, which encourages
  repeated approvals. The optional stable self-signed identity fixes the churn but turns the grant
  into a persistent permission for that signing identity.

**Recommendation**

Either:

- move the item to the data-protection keychain with `kSecUseDataProtectionKeychain` and a proper
  signing identity/access group, then use an access control that matches the desired user-presence
  policy; or
- keep the login-keychain design but **stop claiming** `WhenUnlockedThisDeviceOnly` semantics.
  Describe it as "macOS login Keychain, code-signature ACL, not synchronized" and document that it
  is only as strong as the login keychain and the user's backup configuration.

### F3 — Medium — passphrase rotation leaves old-key copies in the vault

**Evidence**

`change_passphrase` writes a pre-rekey database snapshot and a copy of the old header before
rotation:

- `src-tauri/src/services/vault.rs:452-458` — `pre-rekey-<stamp>.cmdb` and
  `pre-rekey-<stamp>.vault-header`.
- `src-tauri/tests/vault_flow.rs:164-175` explicitly asserts both files still exist after a
  successful rotation.

Nothing deletes them on success. The old header contains the old wrapped DEK, and the pre-rekey
snapshot is encrypted with that old DEK. Therefore someone who obtains the vault directory *after*
a rotation and knows the old passphrase can still decrypt the pre-rekey snapshot. Pre-migration
snapshots encrypted with the old DEK are in the same position. Old `.cmbak` backups remain
decryptable with the old passphrase too, which is documented; the internal snapshots are not.

**Why it matters**

The most common reason to rotate a passphrase is suspected compromise. Rotation currently changes
the live database key but does not make the old passphrase useless against the vault directory's
retained copies. The incident runbook says to delete old backups; it does not mention the hidden
pre-rekey header/snapshot or the pre-migration snapshots.

**Recommendation**

After a successful rotation, delete the pre-rekey artifacts and old-DEK snapshots, or provide an
explicit "retire old recovery copies" action. If they are kept intentionally for crash recovery,
surface them in the UI and document that they are old-passphrase material that must be deleted after
the rotation is verified. At minimum, update the incident runbook and backup/recovery guide.

### F4 — Medium/Low — lock clears Rust state, but visible-data clearing depends on a renderer event

**Evidence**

`AppState::lock` clears the session, drops the DEK, closes the connection, and emits `vault:locked`
(`src-tauri/src/state.rs:148-193`). The renderer listens for that event and flips its boot state
(`src/app/App.tsx:119-149`). The listener's `catch` intentionally ignores subscription failure
because "the Rust session is already closed and commands fail with vault_locked."

That is true for **data access**, but not for **what is on screen**. If the event listener never
registers, or the event is delayed/dropped, `AppShell` remains mounted with the last ledger view and
cached data. The lock screen is not shown until the renderer reacts. The JS heap is not zeroized or
explicitly cleared; React unmounting is not a memory-erasure guarantee. The lock path does not hide
or cover the window natively.

**Why it matters**

The lock's cryptographic guarantee is intact, but a person walking up to the Mac can still see the
last balances/transactions, and a compromised renderer can read its own cached copy. The docs say
"the renderer clears all query caches…"; the implementation is really "the renderer is notified and
unmounts sensitive views on a best-effort event."

**Recommendation**

Make the visual clear fail-safe: on lock, hide or cover the window in Rust (native overlay, blank
webview, or window hide) before/while emitting the event; on renderer startup, poll
`vault_status` and never render the shell unless unlocked. Clear explicit query state on lock, not
just unmount. Do not make the renderer the only path that removes sensitive content from the screen.

### F5 — Low — content-protection is not a reliable screen-capture defense on current macOS

**Evidence**

The app calls `set_content_protected(true)` and sets `NSWindowSharingType::None`
(`src-tauri/src/lib.rs:71-87`, `:241`). That blocks some legacy capture paths, but on macOS 15.4+
ScreenCaptureKit can capture windows that use the legacy sharing-none attribute; Apple has stated
there is no public API that guarantees exclusion from screen capture. This machine is macOS 27.2.1.
The app's own residual-risk section already says screen capture is "not fully preventable," which is
honest; the control should be treated as defense-in-depth, not as a boundary.

**Recommendation**

Keep the call—it is cheap and may block casual legacy capture—but describe it as best-effort. Do
not rely on it for confidentiality; rely on locking and macOS screen lock. Consider a privacy blur
when the app loses focus or when screen capture is suspected, but recognize it can also be captured.

### F6 — Low — the unlock rate limiter is mostly friction, not brute-force protection

**Evidence**

`RateLimiter` is an in-memory sliding window (`src-tauri/src/security/ratelimit.rs`). It is reset on
process restart. `vault_unlock` calls it **before** the native sheet
(`src-tauri/src/commands/mod.rs:406`), so cancelled prompts consume quota. Wrong-passphrase delays
are capped at 4 seconds and also reset on restart (`src-tauri/src/services/vault.rs:324-331`).

**Why it matters**

An attacker who can copy the vault and attack offline is unaffected. An attacker at the keyboard can
relaunch the app to reset the limiter. A legitimate user who cancels a few sheets can be told "too
many attempts" and wait. The actual protection is the Argon2id cost and passphrase strength.

**Recommendation**

Count only failed passphrase attempts (not cancellations), consider persisting a modest failure
counter or making the delay longer, and stop presenting the limiter as a primary brute-force
control. If the goal is accidental-guess throttling, say so. Do not add a permanent lockout without
a recovery path; denial of service is a real risk for a local vault.

### F7 — Low — the audit trail is partial and not tamper-evident

**Evidence**

- `security_events` is an encrypted table in the ledger; anyone with the DEK can edit or roll it
  back. It is not an append-only/external log.
- `reset_scope` deletes all security events for partial restores
  (`src-tauri/src/services/restore.rs:782`).
- `EVENT_TYPES` declares `single_instance_rejected`, `integrity_failure`, `migration_applied`,
  `migration_failed`, `restore_started`, `restore_failed`, and `delete_all`, but no code emits them.
- `plaid_duplicate_blocked` is emitted in `plaid_link.rs` but is not in `EVENT_TYPES`; `record_event`
  rejects it and the error is ignored, so that event is silently lost.
- Unlock failures are only written after a later successful unlock (the DB is inaccessible while
  locked), and the in-memory failure counter resets on relaunch.

At review time, `SECURITY.md` said the trail records "integrity failure, single-instance rejection";
that was not
true today.

**Recommendation**

Either implement the missing events and fix the event-type mismatch, or narrow the documentation.
If audit evidence matters against a local attacker, use an append-only external log or signed
records; the current table is useful for owner self-monitoring, not for proving what happened.

### F8 — Low — zeroization and `mlock` are best-effort, not a guarantee

**Evidence**

`LockedKey` mlock's only its 32-byte box and zeroizes it on drop
(`src-tauri/src/security/crypto.rs:50-104`). But:

- `LockedKey::hex()` creates a normal `String` containing the key and `key_sql` passes it to
  `execute_batch` (`src-tauri/src/security/cipher.rs:33-37`); SQLite/SQLCipher makes its own copies,
  and the temporary string is not zeroized.
- `from_slice` and `derive_kek` use stack arrays that may leave copies before the move into the box.
- Native-sheet strings become Rust `String`s; the `NSString` backing store is AppKit's, not scrubbed.
- HTTP response bodies containing `link_token`/`public_token`/`access_token` are `Vec<u8>`/`String`
  and are not zeroized after deserialization.
- The Keychain JSON document is built in a normal `String`; `SecretString` protects the map values,
  not every transient copy.
- `PRAGMA cipher_memory_security = ON` is executed **after** `PRAGMA key`
  (`src-tauri/src/security/cipher.rs:68-78`), and its success is not checked; `CipherInfo` hardcodes
  `memory_security: true`.
- Renderer data, SQLCipher page cache, and provider secrets held by an in-flight thread are not
  mlocked.

**Recommendation**

Keep the design (it is still better than no zeroization), but avoid absolute claims. Use
`Zeroizing<String>`/scrub buffers for key SQL, HTTP bodies, and Keychain JSON where practical; set
`cipher_memory_security` before keying and verify it; do not report `memory_security: true` without
checking. Document that lock is a logical boundary, not a RAM-erasure guarantee.

### F9 — Low — the passphrase policy is length-only in practice

**Evidence**

`validate_new_passphrase` accepts any passphrase with at least 16 characters
(`src-tauri/src/security/crypto.rs:207-219`). The entropy estimate is only consulted below 16
characters. Sixteen spaces, sixteen `a`s, or a common phrase with added padding all pass.

**Why it matters**

The policy is a weak gate; Argon2id buys time, but a weak passphrase still makes offline guessing
practical. The UI says "at least 16 characters" and the docs call the policy conservative; a user
may infer more assurance than exists.

**Recommendation**

Use a small dictionary/zxcvbn-style check for new passphrases, reject all-whitespace/all-repeated
input, and keep the long-passphrase allowance. Do not add arbitrary composition rules that push
users toward predictable substitutions.

### F10 — Low — dependency advisories are present and not checked in CI

**Evidence**

`cargo audit` currently reports:

```text
RUSTSEC-2026-0459 — libsqlite3-sys 0.35.0 / SQLite < 3.54.0
CVE-2026-119375 — uninitialized page-cache memory with a crafted DB + WAL pair
Severity 6.8 (medium), fixed by libsqlite3-sys >= 0.39.0 for plain SQLite
```

The advisory notes that the **SQLCipher** feature in `libsqlite3-sys` 0.39.0/0.39.1 still bundles
SQLite 3.53.4 and is affected; there is no patched SQLCipher release at the time of this assessment.
The app's threat model already includes same-user malware, and this attack requires the victim to
open a crafted DB/WAL pair. The vault directory is 0700, so the practical severity here is low, but
the dependency is security-critical and the app's own docs recommend `cargo audit`.

`pnpm audit` reports one moderate `minimatch` advisory in the dev-only `typescript-eslint` chain.
No CI job runs either audit, so this drift is invisible until someone runs the commands manually.

**Recommendation**

Track the upstream SQLCipher fix and upgrade `rusqlite`/`libsqlite3-sys` when a SQLCipher build with
SQLite 3.54+ is available. Add `cargo audit` and `pnpm audit --prod` to CI (or a scheduled job) and
document accepted advisories. Do not treat this specific advisory as an emergency for at-rest
confidentiality; treat it as maintenance debt on a critical component.

### F11 — Low — repository artifact hygiene misses some of Cardinal's own files

**Evidence**

`.gitignore` covers `*.cmdb`, `*.cmbak`, `vault.header`, `vault.header.bak`, `pre-migration-v*.cmdb`,
and similar files. It does **not** cover:

- `pre-rekey-*.vault-header` (a wrapped old DEK header),
- `rotation.journal` (new header during rotation),
- `vault-install-*` and `restore-migrate-*` directories.

The gitleaks pre-commit/CI artifact regex has the same blind spots. No such file is tracked today,
so this is prevention debt, not a current leak. But an old-passphrase header sitting next to a DB is
exactly the kind of artifact the repository's own secret-scanning story is meant to catch.

**Recommendation**

Add these patterns to `.gitignore`, the pre-commit artifact check, and the CI artifact check, and
keep the comments in sync. The current secret scanning is still valuable; it is not complete.

### F12 — Informational — documentation and UI claims that did not match the code

The documentation rows below were corrected in the same change as this report; they are listed to
show what the review found and what changed. They were not all vulnerabilities, but in a security
product they were misleading:

| Claim at review | Reality at review |
|---|---|
| `SECURITY.md`: provider secrets use `WhenUnlockedThisDeviceOnly` | Set but not effective in the login keychain (see F2) |
| `SECURITY.md`: audit trail records integrity failure and single-instance rejection | Event types are declared but never emitted (see F7) |
| `SECURITY.md`: "TLS depends on the macOS trust store/proxy" | The client uses rustls with bundled WebPKI roots and `.no_proxy()`; system trust/proxy are bypassed |
| `SECURITY.md`: content protection blocks the standard screen-capture path | Bypassable on macOS 15.4+ by ScreenCaptureKit; best-effort only |
| `docs/security/architecture.md`: lock observes logout via `NSWorkspaceWillPowerOff` | No such notification code; logout relies on process termination/polling |
| `docs/security/architecture.md`: rate limits "reset only on success or lock" | The in-memory limiter also resets on process restart (and counts cancellations) |
| `docs/security/threat-model.md`: "pinned toolchains" | Rust uses `channel = "stable"`; Node has an engine range; only pnpm and the lockfiles are pinned |
| `README.md`: "The build is ad-hoc signed" | The executable is linker-signed; the bundle is not validly signed (see F1) |
| Native Plaid sheet: "WhenUnlockedThisDeviceOnly" | Same as F2; user-facing overclaim |

**Recommendation**

Correct these in the same pass as the code fixes. Security documentation is part of the product;
overclaims train users to trust controls that do not hold.

## 5. Benefit vs. inconvenience

| Control | Real benefit | User cost | Assessment |
|---|---|---|---|
| Native AppKit secure sheet | Strong: renderer/keylogger isolation, fixed text, no HTML fallback | Modal, no inline UI | **Keep.** One of the best controls in the app. |
| SQLCipher + Argon2id + authenticated header | Strong at-rest protection | ~350 ms unlock | **Keep.** Core value; KDF cost is reasonable. |
| Login Keychain for Plaid secrets | Real protection against other apps, subject to prompts | One prompt per rebuild; one item exposes all | **Keep with corrected claims**; fix signing identity or use data-protection keychain. |
| One Keychain item instead of one per secret | Fewer prompts, simpler migration | Larger blast radius; one "Always Allow" covers everything | **Reasonable convenience**, but do not present it as stronger security. |
| Lock on screen lock/sleep/session switch/quit | Strong, no user friction | Occasional lock while idle | **Keep.** |
| Idle auto-lock from native HID | Protects when you leave the Mac | It is system-wide inactivity, not app inactivity; stays unlocked while you use another app | **Keep, but describe accurately.** |
| Renderer unlock event | Clears sensitive views promptly | Can be missed; not fail-safe | **Improve** (F4), not remove. |
| Unlock rate limiter | Marginal at the keyboard; none offline | Counts cancellations, resets on restart, can annoy | **Revise or remove** (F6). |
| Screen-capture protection | Blocks some legacy capture | None | **Keep as defense-in-depth**, never rely on it (F5). |
| Encrypted audit trail | Useful owner observability | None | **Keep, narrow claims** (F7). |
| CSP, minimal capability, typed IPC, no renderer network | Strong defense-in-depth against XSS/exfil | Slight development friction | **Keep.** |
| DevTools off | Stops casual inspection | Debugging harder | **Keep**, but not a boundary against local malware. |
| 16-character passphrase minimum | Raises offline cost floor | Mild | **Strengthen with a dictionary check** (F9). |
| Separate backup passphrase option | Lets backups survive a vault rotation | Extra secret to manage | **Keep.** |
| Ad-hoc/linker signing | None as currently built; causes prompt churn | Gatekeeper failure, no bundle integrity | **Fix** (F1); do not count it as a security feature. |

## 6. Prioritized recommendations

**P0 — do before relying on the app for real data**

1. Sign the app bundle and verify it: `codesign --verify --deep --strict` must pass. Prefer a
   stable local signing identity; consider hardened runtime. If the bundle cannot be signed,
   document that Gatekeeper will reject it and that resource/Info.plist integrity is not protected.
2. Decide what rotation means: after a successful passphrase change, delete the pre-rekey header
   and snapshot (and old-DEK snapshots), or explicitly mark them as old-passphrase recovery copies
   and add them to the incident runbook. This is the difference between "rotated" and "the old
   passphrase still opens copies in the vault."
3. Correct the Keychain claim in `SECURITY.md` and the native sheet. Either implement
   `kSecUseDataProtectionKeychain` with the right entitlement, or describe the real login-keychain
   protection. (The documentation/UI text was corrected in this pass; the design is unchanged.)

**P1 — high-value hardening**

4. Make lock clear the screen fail-safely: hide/cover the window from Rust on lock, and have the
   renderer verify `vault_status` before showing the shell.
5. Fix the event-type mismatch (`plaid_duplicate_blocked`) and either emit the missing audit events
   or stop claiming them. Add a note that the trail is not tamper-evident.
6. Add `cargo audit` and `pnpm audit --prod` to CI/scheduled checks; track the SQLCipher-upstream
   advisory.
7. Add the missing artifact patterns (`pre-rekey-*.vault-header`, `rotation.journal`,
   `vault-install-*`, `restore-migrate-*`) to `.gitignore` and the secret-scan artifact checks.

**P2 — polish and truthful claims**

8. Change the rate limiter to count failed attempts only, or remove it; stop calling it a
   brute-force defense.
9. Improve passphrase policy for new passphrases (dictionary/entropy check, reject all-whitespace
   and repeated-only).
10. Scrub or zeroize transient key/token strings where practical; set and verify
    `cipher_memory_security` before keying; remove the hardcoded `memory_security: true`.
11. Keep the corrected documentation in sync with code. The F12 claims were amended in this pass;
    review them again when the underlying behavior changes.
12. Add a small native/integration test for lock-on-screen-lock, native sheet failure, and
    Keychain behavior where feasible; browser tests cannot prove those.

## 7. Verification notes and limitations

- Frontend suite: 27 files, 178 tests, all passing (`pnpm test`).
- Rust security unit tests: 29 passing (`cargo test --lib security::`).
- Build artifact: `codesign`/`spctl` fail as shown in F1. This is the current artifact at
  `src-tauri/target/release/bundle/macos/Cardinal.app`; the build was not re-signed for this
  assessment.
- Dependency scans: `cargo audit` reports RUSTSEC-2026-0459; `pnpm audit` reports one moderate
  dev-only minimatch advisory.
- No interactive native tests were run: the AppKit sheet, Keychain ACL prompts, screen-lock
  notifications, ScreenCaptureKit, and Gatekeeper launch were not exercised. Statements about those
  are based on code and public platform behavior.
- Documentation corrections in this pass: `SECURITY.md` (Keychain, audit trail, TLS, screen capture,
  bundle signing), `README.md` (signing/status), the security architecture (rotation, lock,
  Keychain, rate limits, screen capture), threat model, Plaid guide, backup/recovery guide, incident
  runbook, docs index, and the two native Plaid credential prompts. No security behavior was changed
  by this pass.
- This assessment is not a penetration test and does not cover WebKit/AppKit zero-days, kernel
  attacks, physical attacks, or a compromised Plaid/bank.

## 8. References

- ScreenCaptureKit and legacy sharing-none behavior:
  [Tauri issue #14200](https://github.com/tauri-apps/tauri/issues/14200) and
  [Apple Developer Forums thread 792152](https://developer.apple.com/forums/thread/792152).
- macOS file-based versus data-protection Keychain:
  [Apple Developer Forums thread 691213](https://developer.apple.com/forums/thread/691213) and
  [`kSecUseDataProtectionKeychain`](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain).
- SQLCipher/SQLite advisory:
  [RUSTSEC-2026-0459](https://rustsec.org/advisories/RUSTSEC-2026-0459) /
  [CVE-2026-119375](https://www.cve.org/CVERecord?id=CVE-2026-119375).

## 9. Bottom line

Cardinal's cryptographic core and renderer boundary are credible and clearly built with care. The
gap is not "the encryption is fake"; the gap is that the **build integrity and a few surrounding
claims do not live up to the security posture the app presents**. Fix signing, decide how rotation
retires old material, correct the Keychain and audit claims, and make lock clear the screen
fail-safely; after that, this is a solid personal local-first finance app with a documented,
reasonable residual-risk profile.
