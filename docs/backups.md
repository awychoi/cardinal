# Backup and recovery

Cardinal stores the ledger in a SQLCipher database in its app-data directory. Backups are encrypted,
self-contained containers: each carries its own vault header, so it opens without the original
`vault.header`, including on a fresh install.

**There is no recovery for a lost passphrase.** A backup helps only if you know the passphrase that
protected it. There is no reset, escrow, support override, or hidden account.

## Where and what

- App backups: `~/Library/Application Support/com.awychoi.cardinal/backups/`
- Files: `cm-backup-<kind>-<vault-prefix>-gen<generation>-<UTC>-<nonce>.cmbak`, mode `0600`.
- Kinds: daily, manual, pre-migration, pre-restore, pre-change, and legacy portable.
- Retention: 7 daily, 10 manual, and 5 of each pre-change kind, never the last backup. Only the
  current vault's normal containers are counted.
- Backups do not include Keychain items, Plaid tokens, or the Plaid client secret.
- Backups from before the Cardinal rename remain restorable.

## Back up now

Use **Settings → Backups & recovery → Back up now**, or **Back up now** on the locked gate.

1. Choose a destination in the native save dialog (defaults to the app backup directory).
2. Enter a backup passphrase.
   - Leave it blank to use the current vault passphrase and data key.
   - Enter a different passphrase (16+ characters) to give this backup its own key. It uses the
     current KDF parameters and vault identity.
3. While locked, the app also asks for the current vault passphrase so it can open the ledger long
   enough to snapshot it. It stays locked and shows no ledger data.
4. Backups in the app directory are listed and pruned by the manual limit. Backups elsewhere are
   neither listed nor pruned; you own them.

Automatic: a daily backup after unlock when the last one is at least 24 hours old; a pre-migration
backup before schema changes; a pre-restore backup before replacing a vault; a pre-change backup
before a passphrase rotation. A backup failure never blocks unlock.

After a successful rotation, old-key copies remain: `pre-rekey-<stamp>.cmdb`,
`pre-rekey-<stamp>.vault-header`, and older `pre-migration-*.cmdb` files still open with the old
passphrase. Once the new passphrase is verified, delete them and old `.cmbak` backups that use the
old passphrase. Nothing removes them automatically.

## Restore

Restore validates a staged copy before touching the live vault. The native picker and secure sheets
collect the file and passphrases.

1. Choose the `.cmbak` file and review its kind, vault prefix, schema, and generation.
2. Choose a scope:
   - **Full database** — everything.
   - **Financial data + settings** — financial tables, settings, merchant rules, and import history;
     connections, account sources, sync history, and security events are reset.
   - **Financial data only** — financial tables only; settings return to defaults and connections,
     account sources, sync history, and import history are reset.
3. Type `replace` when replacing an existing vault.
4. For a backup from a different vault, choose what happens to the old vault's Plaid Items: delete
   local tokens, delete and revoke them remotely, or keep them for rollback.
5. A backup file that is not owner-only needs an explicit acknowledgement. Other checks still run.
6. Enter the backup passphrase. For a locked existing vault, enter the current passphrase too so a
   pre-restore backup can be made.

Outcomes:

- **Same vault** — keeps the current vault ID, header, and data key. A pre-restore backup is made
  first and any failure aborts before the swap.
- **Different vault (full)** — adopts the backup's vault ID; the backup passphrase becomes the vault
  passphrase with a fresh header and data key. Old backups are renamed `cm-retired-` and excluded
  from listing and pruning.
- **Fresh install** — adopts the backup's identity and passphrase; no pre-restore backup.
- **Partial scope** — keeps the current identity and data key; unselected groups are reset.
- **Destructive, no current passphrase** — full database only; installs the verified backup with a
  fresh header and asks whether to delete all app-managed provider tokens. This also recovers a
  header-only vault whose database was lost.

After restore, connections clear their cursors and resync. Restored balances, credit limits, and due
metadata stay hidden until fresh provider data arrives; restored transaction history remains visible.
A connection whose token is still in this Mac's Keychain reuses the same Plaid Item; otherwise it
shows **Link again…** and creates a new one. Tokens never travel in a backup.

A successful restore offers **Change passphrase now** or **Change later**. For cross-vault and fresh
restores, the backup passphrase is already the current passphrase. Cancelling the sheet leaves the
restore valid.

## Recovery scenarios

- **Header lost or corrupt** — the ledger cannot open in place even if the database survives. Restore
  a self-contained backup from the locked gate; use the destructive path or a fresh install if the
  current passphrase is unavailable.
- **Passphrase lost** — no recovery. Only a backup whose passphrase is known can help.
- **Corrupt database or failed migration** — preserve the vault directory and restore the newest
  verified backup. A failed migration rolls back and keeps its pre-migration backup.
- **Failed restore** — validation and the pre-restore backup run before replacement, so the live
  ledger should be unchanged. If a post-swap failure is reported, preserve the vault directory and
  use the `pre-restore` backup; a crash between file renames is a narrow window mitigated by that
  backup and `.cmdb.restore-old`.
- **Failed rotation** — try the new passphrase if the rekey completed, otherwise the old one, then
  restore the pre-change backup. Do not delete the rotation journal by hand.
- **Stolen backup or disk** — rotate the vault passphrase and delete old backups; they remain
  decryptable with the old passphrase until deleted. Revoke Plaid Items and rotate the client secret
  separately.
- **Erase all local data** — **Settings → Backups & recovery → Erase all local data…** requires typed
  and native confirmation. It removes the vault, header and mirror, journal, backups, demo database,
  staged files, and app-managed provider tokens with a best-effort overwrite. It cannot erase Time
  Machine, cloud copies, exports, or other devices.
