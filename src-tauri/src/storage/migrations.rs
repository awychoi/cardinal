//! Forward-only migrations with checksum verification and a pre-migration
//! encrypted snapshot. A failed migration rolls back its transaction and
//! leaves the original database intact.

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};
use crate::security::crypto::LockedKey;
use crate::storage::snapshot::create_encrypted_snapshot;
use crate::storage::time::now_rfc3339;

pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial_metadata_settings_events",
        sql: include_str!("../../migrations/0001_initial.sql"),
    },
    Migration {
        version: 2,
        name: "domain_accounts_transactions",
        sql: include_str!("../../migrations/0002_domain.sql"),
    },
    Migration {
        version: 3,
        name: "edits_rules_imports",
        sql: include_str!("../../migrations/0003_edits_rules_imports.sql"),
    },
    Migration {
        version: 4,
        name: "restored_provider_snapshots",
        sql: include_str!("../../migrations/0004_restored_provider_snapshots.sql"),
    },
    Migration {
        version: 5,
        name: "depository_accounts",
        sql: include_str!("../../migrations/0005_depository_accounts.sql"),
    },
];

pub fn supported_schema_version() -> u32 {
    MIGRATIONS.last().map(|m| m.version).unwrap_or(0)
}

fn checksum(sql: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(sql.as_bytes());
    hex::encode(hasher.finalize())
}

fn ensure_migration_table(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL,
            applied_at TEXT NOT NULL
        ) STRICT;",
    )?;
    Ok(())
}

fn applied(conn: &Connection) -> AppResult<Vec<(u32, String)>> {
    let mut stmt =
        conn.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}

fn foreign_keys_enabled(conn: &Connection) -> AppResult<bool> {
    let enabled: i64 = conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0))?;
    Ok(enabled == 1)
}

fn set_foreign_keys(conn: &Connection, enabled: bool) -> AppResult<()> {
    // This pragma is a no-op inside a transaction; verify the intended state
    // instead of assuming it took effect. A migration that rebuilds a parent
    // table must never run with cascading deletes armed.
    conn.execute_batch(if enabled {
        "PRAGMA foreign_keys = ON;"
    } else {
        "PRAGMA foreign_keys = OFF;"
    })?;
    if foreign_keys_enabled(conn)? != enabled {
        return Err(AppError::Database);
    }
    Ok(())
}

fn foreign_key_violation(conn: &Connection) -> AppResult<bool> {
    let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
    let mut rows = stmt.query([])?;
    Ok(rows.next()?.is_some())
}

/// Apply pending migrations. `dek` is needed for the pre-migration encrypted
/// snapshot; `snapshot_dir` is the vault directory.
pub fn run_migrations(
    conn: &Connection,
    dek: &LockedKey,
    snapshot_dir: &std::path::Path,
) -> AppResult<u32> {
    ensure_migration_table(conn)?;
    let already = applied(conn)?;
    let supported = supported_schema_version();

    for (version, stored_checksum) in &already {
        let Some(known) = MIGRATIONS.iter().find(|m| m.version == *version) else {
            return Err(AppError::SchemaTooNew);
        };
        if &checksum(known.sql) != stored_checksum {
            // An applied migration was edited. Fail closed rather than operate
            // on a schema whose provenance we cannot trust.
            return Err(AppError::Database);
        }
    }

    let pending: Vec<&Migration> = MIGRATIONS
        .iter()
        .filter(|m| !already.iter().any(|(v, _)| *v == m.version))
        .collect();
    if pending.is_empty() {
        return Ok(already.iter().map(|(v, _)| *v).max().unwrap_or(0));
    }

    // A pre-migration snapshot is only needed for a non-empty ledger. An
    // initial empty database does not need one.
    let table_count: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'",
        [],
        |row| row.get(0),
    )?;

    // Migration 5 rebuilds the accounts table. Foreign-key actions are
    // disabled for the DDL and verified again below, because dropping a parent
    // table with enforcement on performs an implicit delete that cascades.
    let fk_on = foreign_keys_enabled(conn)?;
    if fk_on {
        set_foreign_keys(conn, false)?;
    }

    let outcome = (|| -> AppResult<u32> {
        if table_count > 0 {
            let target = pending.last().map(|m| m.version).unwrap_or(supported);
            let stamp = now_rfc3339().replace([':', '-'], "");
            let path = snapshot_dir.join(format!("pre-migration-v{target}-{stamp}.cmdb"));
            create_encrypted_snapshot(conn, &path, dek)?;
        }

        for migration in &pending {
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(migration.sql)?;
            tx.execute(
                "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    migration.version,
                    migration.name,
                    checksum(migration.sql),
                    now_rfc3339()
                ],
            )?;
            tx.commit()?;
        }

        Ok(applied(conn)?.iter().map(|(v, _)| *v).max().unwrap_or(0))
    })();

    let restored = if fk_on {
        set_foreign_keys(conn, true)
    } else {
        Ok(())
    };

    let version = match (outcome, restored) {
        (Ok(version), Ok(())) => version,
        (Ok(_), Err(error)) => return Err(error),
        (Err(error), _) => return Err(error),
    };

    if fk_on && foreign_key_violation(conn)? {
        return Err(AppError::Database);
    }

    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_version_matches_latest_migration() {
        assert_eq!(supported_schema_version(), 5);
        assert_eq!(MIGRATIONS[0].version, 1);
        assert_eq!(MIGRATIONS[1].version, 2);
        assert_eq!(MIGRATIONS[2].version, 3);
        assert_eq!(MIGRATIONS[3].version, 4);
        assert_eq!(MIGRATIONS[4].version, 5);
        assert!(!checksum(MIGRATIONS[4].sql).is_empty());
    }

    #[test]
    fn depository_migration_preserves_accounts_and_child_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        for migration in &MIGRATIONS[..4] {
            conn.execute_batch(migration.sql).unwrap();
        }
        conn.execute(
            "INSERT INTO accounts (id, issuer, display_name, last_four, account_type, currency, \
                credit_limit_minor, include_in_overview, archived, source_kind, created_at, updated_at) \
             VALUES ('11111111-1111-4111-8111-111111111111', 'Fixture Bank', 'Everyday', '1111', \
                'credit_card', 'USD', 500000, 1, 0, 'manual', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO manual_payment_metadata (account_id, statement_balance_minor, \
                minimum_due_minor, next_due_date, valid_through_date, created_at, updated_at) \
             VALUES ('11111111-1111-4111-8111-111111111111', 120000, 2500, '2026-02-01', NULL, \
                '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        // Match the runner: enforcement is off for the rebuild.
        set_foreign_keys(&conn, false).unwrap();
        conn.execute_batch(MIGRATIONS[4].sql).unwrap();
        set_foreign_keys(&conn, true).unwrap();

        assert!(!foreign_key_violation(&conn).unwrap());
        let account_type: String = conn
            .query_row(
                "SELECT account_type FROM accounts WHERE id = '11111111-1111-4111-8111-111111111111'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(account_type, "credit_card");
        let children: i64 = conn
            .query_row("SELECT count(*) FROM manual_payment_metadata", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(children, 1, "the rebuild must not cascade into children");

        conn.execute(
            "INSERT INTO accounts (id, issuer, display_name, last_four, account_type, currency, \
                credit_limit_minor, include_in_overview, archived, source_kind, created_at, updated_at) \
             VALUES ('22222222-2222-4222-8222-222222222222', 'Fixture Bank', 'Checking', '2222', \
                'checking', 'USD', NULL, 1, 0, 'manual', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
    }
}
