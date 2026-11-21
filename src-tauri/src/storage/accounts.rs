//! Account repository. Manual accounts are the Phase 4 path; provider mapping
//! is Phase 8/9. Validation happens here even when the UI also validates.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::domain::money::currency_exponent;
use crate::domain::text::{clean_text, MAX_DESCRIPTION_CHARS};
use crate::error::{AppError, AppResult};
use crate::storage::time::now_rfc3339;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountType {
    CreditCard,
    ChargeCard,
    LineOfCredit,
    Checking,
    Savings,
    /// A depository account whose product Plaid did not describe more
    /// specifically (for example cash management or an unrecognized subtype).
    Depository,
    Other,
}

impl AccountType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CreditCard => "credit_card",
            Self::ChargeCard => "charge_card",
            Self::LineOfCredit => "line_of_credit",
            Self::Checking => "checking",
            Self::Savings => "savings",
            Self::Depository => "depository",
            Self::Other => "other",
        }
    }

    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "credit_card" => Ok(Self::CreditCard),
            "charge_card" => Ok(Self::ChargeCard),
            "line_of_credit" => Ok(Self::LineOfCredit),
            "checking" => Ok(Self::Checking),
            "savings" => Ok(Self::Savings),
            "depository" => Ok(Self::Depository),
            "other" => Ok(Self::Other),
            _ => Err(AppError::InvalidInput("account type")),
        }
    }

    /// Cash accounts. Everything else, including the legacy `other` value,
    /// keeps the liability treatment it had before bank accounts existed.
    pub fn is_depository(self) -> bool {
        matches!(self, Self::Checking | Self::Savings | Self::Depository)
    }
}

pub fn is_depository_type(value: &str) -> bool {
    matches!(value, "checking" | "savings" | "depository")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInput {
    pub issuer: String,
    pub display_name: String,
    pub last_four: Option<String>,
    pub account_type: AccountType,
    pub currency: String,
    pub credit_limit_minor: Option<i64>,
    pub current_balance_minor: Option<i64>,
    pub include_in_overview: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub issuer: String,
    pub display_name: String,
    pub last_four: Option<String>,
    pub account_type: String,
    pub currency: String,
    pub credit_limit_minor: Option<i64>,
    pub include_in_overview: bool,
    pub archived: bool,
    pub source_kind: String,
    pub created_at: String,
    pub updated_at: String,
}

fn validate_input(input: &AccountInput) -> AppResult<(String, String, Option<String>, String)> {
    let issuer =
        clean_text(&input.issuer, 80, false).map_err(|_| AppError::InvalidInput("issuer"))?;
    let display_name = clean_text(&input.display_name, 120, false)
        .map_err(|_| AppError::InvalidInput("display name"))?;
    let last_four = match &input.last_four {
        None => None,
        Some(value) => {
            let value = value.trim();
            if value.len() != 4 || !value.chars().all(|c| c.is_ascii_digit()) {
                return Err(AppError::InvalidInput("last four"));
            }
            Some(value.to_string())
        }
    };
    let currency = input.currency.trim().to_uppercase();
    if currency.len() != 3 || currency_exponent(&currency).is_none() {
        return Err(AppError::InvalidInput("currency"));
    }
    if let Some(limit) = input.credit_limit_minor {
        if input.account_type.is_depository() {
            return Err(AppError::InvalidInput("credit limit"));
        }
        if !(1..=1_000_000_000_000).contains(&limit) {
            return Err(AppError::InvalidInput("credit limit"));
        }
    }
    if let Some(balance) = input.current_balance_minor {
        if !input.account_type.is_depository() {
            return Err(AppError::InvalidInput("current balance"));
        }
        if !(-1_000_000_000_000..=1_000_000_000_000).contains(&balance) {
            return Err(AppError::InvalidInput("current balance"));
        }
    }
    let _ = MAX_DESCRIPTION_CHARS;
    Ok((issuer, display_name, last_four, currency))
}

fn latest_manual_balance(conn: &Connection, account_id: &str) -> AppResult<Option<i64>> {
    conn.query_row(
        "SELECT current_balance_minor FROM balance_snapshots \
         WHERE account_id = ?1 AND provenance = 'manual' \
         ORDER BY retrieved_at DESC, rowid DESC LIMIT 1",
        [account_id],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|error| match error {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(AppError::from(other)),
    })
}

fn record_manual_balance(
    conn: &Connection,
    account_id: &str,
    balance_minor: i64,
    currency: &str,
    now: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO balance_snapshots (id, account_id, current_balance_minor, available_credit_minor, \
            credit_limit_minor, currency, retrieved_at, provider_as_of, provenance, source_connection_id) \
         VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, NULL, 'manual', NULL)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            account_id,
            balance_minor,
            currency,
            now
        ],
    )?;
    Ok(())
}

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        issuer: row.get(1)?,
        display_name: row.get(2)?,
        last_four: row.get(3)?,
        account_type: row.get(4)?,
        currency: row.get(5)?,
        credit_limit_minor: row.get(6)?,
        include_in_overview: row.get::<_, i64>(7)? != 0,
        archived: row.get::<_, i64>(8)? != 0,
        source_kind: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const SELECT: &str = "SELECT id, issuer, display_name, last_four, account_type, currency, \
    credit_limit_minor, include_in_overview, archived, source_kind, created_at, updated_at \
    FROM accounts";

pub fn create_manual(conn: &Connection, input: &AccountInput) -> AppResult<Account> {
    let (issuer, display_name, last_four, currency) = validate_input(input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO accounts (id, issuer, display_name, last_four, account_type, currency, \
            credit_limit_minor, include_in_overview, archived, source_kind, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 'manual', ?9, ?9)",
        rusqlite::params![
            id,
            issuer,
            display_name,
            last_four,
            input.account_type.as_str(),
            currency,
            input.credit_limit_minor,
            i64::from(input.include_in_overview),
            now
        ],
    )?;
    if let Some(balance) = input.current_balance_minor {
        record_manual_balance(conn, &id, balance, &currency, &now)?;
    }
    get(conn, &id)
}

pub fn update_manual(conn: &Connection, id: &str, input: &AccountInput) -> AppResult<Account> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidInput("account id"))?;
    let (issuer, display_name, last_four, currency) = validate_input(input)?;
    let (source_kind, existing_type, existing_currency): (String, String, String) = conn
        .query_row(
            "SELECT source_kind, account_type, currency FROM accounts WHERE id = ?1 AND archived = 0",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
            other => AppError::from(other),
        })?;
    // The form has no currency picker, and silently re-denominating an account
    // would revalue every balance and total. Require a new account instead.
    if currency != existing_currency {
        return Err(AppError::InvalidInput("currency"));
    }
    // A cash balance and a card balance mean opposite things. Converting an
    // account across that line would silently flip thousands of dollars in the
    // overview, so require a new account instead.
    if is_depository_type(&existing_type) != input.account_type.is_depository() {
        return Err(AppError::InvalidInput("account type"));
    }
    // Provider balances are owned by sync. A manual snapshot on a provider
    // account would be overwritten at the next sync and would misrepresent
    // where the number came from.
    if input.current_balance_minor.is_some() && source_kind != "manual" {
        return Err(AppError::InvalidInput("current balance"));
    }
    let now = now_rfc3339();
    let changed = conn.execute(
        "UPDATE accounts SET issuer = ?2, display_name = ?3, last_four = ?4, account_type = ?5, \
            currency = ?6, credit_limit_minor = ?7, include_in_overview = ?8, updated_at = ?9 \
         WHERE id = ?1 AND archived = 0",
        rusqlite::params![
            id,
            issuer,
            display_name,
            last_four,
            input.account_type.as_str(),
            currency,
            input.credit_limit_minor,
            i64::from(input.include_in_overview),
            now
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    if source_kind == "manual" {
        if let Some(balance) = input.current_balance_minor {
            if latest_manual_balance(conn, id)? != Some(balance) {
                record_manual_balance(conn, id, balance, &currency, &now)?;
            }
        }
    }
    get(conn, id)
}

pub fn set_archived(conn: &Connection, id: &str, archived: bool) -> AppResult<Account> {
    uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidInput("account id"))?;
    let changed = conn.execute(
        "UPDATE accounts SET archived = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, i64::from(archived), now_rfc3339()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Account> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row_to_account)
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound,
            other => AppError::from(other),
        })
}

pub fn list(conn: &Connection, include_archived: bool) -> AppResult<Vec<Account>> {
    let sql = format!(
        "{SELECT}{} ORDER BY issuer COLLATE NOCASE, display_name COLLATE NOCASE, id",
        if include_archived {
            ""
        } else {
            " WHERE archived = 0"
        }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_account)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
}
