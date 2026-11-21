-- Migration 5: depository accounts. Cardinal started as a credit-card ledger,
-- so the original account_type CHECK admitted only credit-like products. SQLite
-- cannot widen a CHECK constraint in place; rebuild the table, copy every row,
-- and recreate its index. The migration runner disables foreign-key actions for
-- the rebuild so dropping the old table cannot cascade into child rows, then
-- re-enables enforcement and runs PRAGMA foreign_key_check before committing.

CREATE TABLE accounts_next (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    issuer TEXT NOT NULL CHECK (length(issuer) BETWEEN 1 AND 80),
    display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    last_four TEXT CHECK (last_four IS NULL OR (length(last_four) = 4 AND last_four NOT GLOB '*[^0-9]*')),
    account_type TEXT NOT NULL CHECK (account_type IN (
        'credit_card',
        'charge_card',
        'line_of_credit',
        'checking',
        'savings',
        'depository',
        'other'
    )),
    currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
    credit_limit_minor INTEGER CHECK (credit_limit_minor IS NULL OR credit_limit_minor > 0),
    include_in_overview INTEGER NOT NULL DEFAULT 1 CHECK (include_in_overview IN (0, 1)),
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'provider', 'demo')),
    created_at TEXT NOT NULL CHECK (length(created_at) = 20),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 20)
) STRICT;

INSERT INTO accounts_next (
    id,
    issuer,
    display_name,
    last_four,
    account_type,
    currency,
    credit_limit_minor,
    include_in_overview,
    archived,
    source_kind,
    created_at,
    updated_at
)
SELECT
    id,
    issuer,
    display_name,
    last_four,
    account_type,
    currency,
    credit_limit_minor,
    include_in_overview,
    archived,
    source_kind,
    created_at,
    updated_at
FROM accounts;

DROP TABLE accounts;

ALTER TABLE accounts_next RENAME TO accounts;

CREATE INDEX accounts_active_idx ON accounts (archived, include_in_overview);
