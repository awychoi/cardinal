# Plaid setup and linking

Cardinal supports two Plaid environments with separate credentials:

| Environment | Host | What a link creates | Use |
| --- | --- | --- | --- |
| Sandbox | `sandbox.plaid.com` | Synthetic test Items | Development and checks; no real bank data |
| Trial / Production | `production.plaid.com` | Real Items at real institutions | Plaid's free Trial plan or a paid Production plan |

Trial/Production Items contain real financial data and count against the plan's Production Item
limit. The Trial includes up to 10 Production Items, and removing an Item does not restore capacity.
Transactions and Liabilities are subscription products that can bill after upgrading from Trial.

Credit-card linking is the most exercised path. Depository accounts are implemented and tested;
verify live depository linking and live reconnect with your own institution before relying on them.

## Prerequisites

1. A Plaid Dashboard account with a verified email.
2. Environment credentials: Sandbox client ID and secret, or Production client ID and secret.
3. Transactions, Balance, and optional Liabilities enabled for the account.
4. Billing and limits acknowledged. Sandbox is free; Production and Liabilities can bill while an
   Item exists, including while it is broken. `/item/remove` is the off-switch and does not restore
   Trial capacity.

Never send the secret, access token, public token, link token, or Hosted Link URL in chat or commit
them.

## Link a bank

1. Unlock the real vault. Plaid is unavailable in demo mode.
2. Open **Settings → Accounts → Bank connections → Plaid connection**.
3. Select **Sandbox** or **Trial / Production**.
4. Add the client ID and matching secret in the native secure sheet. Credentials stay in the login
   Keychain; Sandbox and Production keys never mix.
5. Optionally use **Test credentials** to check that environment against its host without opening
   Hosted Link.
6. Choose **Link a Sandbox institution…** or **Link a real institution…**.
7. Complete Link in the browser. Plaid credit and depository accounts are imported; loans,
   investments, and other products are ignored. If 0 accounts are imported, remove the Item or link
   a different one.
8. The first Transactions Sync and balance fetch run. Liabilities is attempted and shown as
   unavailable or partial if the Item or plan lacks it.

Rust creates the Hosted Link session, opens only the Plaid URL in the system browser, and polls for
completion. The URL is a short-lived bearer and is never logged or persisted. The app never sees bank
usernames, passwords, or MFA codes.

### Sandbox test data

Choose a Sandbox institution with a credit card or a depository account. For example, First Platypus
Bank (`ins_109508`) with username `user_transactions_dynamic` and any non-blank password.

## Transaction history

Plaid defaults to 90 days when `transactions.days_requested` is omitted, and the window is fixed when
the Item is created. Cardinal requests 730 days (about 24 months) on every first-time link. The
history then fills over the first few syncs; the first `/transactions/sync` call often returns
nothing.

An Item linked by an older build keeps its original window. Remove and relink the institution to pull
older months; rows already imported remain.

## Duplicate prevention

Cardinal keeps one active Plaid Item per institution and environment. One bank login normally covers
every card and account at that institution, and the guard avoids spending the finite Trial allowance
on an accidental second link.

- Rust reads the institution from `/link/token/get` and checks active connections before
  `/item/public_token/exchange`.
- If the institution is already connected, the exchange is refused, no access token is requested,
  and no Item is created. The event is recorded and the UI points to **Update…** / **Reconnect…**.
- A `disconnected` connection, or a restored connection with no local token, is exempt so a fresh
  link can repair it.
- The guard applies to new links only. Duplicates created by an older build remain until handled
  outside the flow.

Two separate logins at the same institution cannot both be active. This is intentional; there is no
override.

## Reconnect and update

A healthy connection shows **Update…**; an unhealthy one shows **Reconnect…**. Both use Plaid update
mode with the stored access token, so the Item, account mapping, and transactions are kept. A
Sandbox connection uses Sandbox credentials and host; a Production connection uses Production.

A revoked or expired token first demotes the connection to `reconnect_required` on the next sync. If
update mode cannot repair it, use **Link again…** to create a new Item.

## Restore and Item reuse

Provider tokens are never written into a backup; they live in this Mac's Keychain, keyed by the
ledger's opaque `credential_ref`. A restored reference that still has a token here can reuse the same
Item:

- Same-vault and fresh-install restores reuse matching local Items automatically and resync.
- Cross-vault and destructive restores offer **reuse local Items**, delete local tokens, delete and
  revoke remotely, or keep for rollback.
- A connection with no local token rotates to a `newlink-…` reference and needs **Link again…**.
- A backup restored on another Mac always needs new Items.

Reuse preserves Trial capacity because `/item/remove` is permanent for the allowance. See
[backups.md](backups.md) for the restore flow.

## Disconnect

Local disconnect deletes the access token from the Keychain and marks the connection disconnected. It
first attempts `/item/remove` against the connection's environment; a remote failure does not leave a
local token behind. For a real Item, confirm in the Plaid Dashboard that the Item is gone; only
`/item/remove` stops subscription billing.
