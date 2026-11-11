//! Read-only dashboard assembly. All financial values come from the tested
//! storage services; the renderer only formats them.

use serde::Serialize;

use crate::domain::dates::{self, Month};
use crate::error::{AppError, AppResult};
use crate::state::{AppState, SessionMode};
use crate::storage::ledger::{
    account_spend, latest_activity, month_summary, spend_history as ledger_spend_history,
    AccountSpend, LatestActivity, MonthSummary, SpendHistory,
};
use crate::storage::overview::{overview, Overview};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub mode: &'static str,
    pub demo: bool,
    pub month: String,
    pub current_month: String,
    pub previous_month: String,
    pub next_month: String,
    pub start_date: String,
    pub end_date_exclusive: String,
    pub currency: String,
    pub summary: MonthSummary,
    pub overview: Overview,
    pub account_spend: Vec<AccountSpend>,
    /// Newest month that still has a visible ledger row, independent of the
    /// selected month. A month-scoped view uses it to point at real data when
    /// the selected month is empty — the normal state right after the first
    /// sync of a fresh connection on the first days of a month. `None` means
    /// the ledger has no visible rows anywhere.
    pub latest_activity: Option<LatestActivity>,
}

pub fn get(state: &AppState, requested_month: Option<String>) -> AppResult<Dashboard> {
    let demo = state.mode() == SessionMode::Demo;
    state.with_db(|conn, _header, settings| {
        let today = if demo {
            crate::demo::demo_today()
        } else {
            dates::today(&settings.timezone).map_err(|_| AppError::InvalidInput("timezone"))?
        };
        let month = match requested_month.as_deref() {
            Some(value) if !value.is_empty() => {
                Month::parse(value).map_err(|_| AppError::InvalidInput("month"))?
            }
            _ => Month::from_date(today),
        };
        let summary = month_summary(conn, month, "USD")?;
        let overview = overview(conn, today)?;
        let account_spend = account_spend(conn, month)?;
        let latest_activity = latest_activity(conn)?;
        let current_month = Month::from_date(today);
        Ok(Dashboard {
            mode: if demo { "demo" } else { "real" },
            demo,
            month: month.key(),
            current_month: current_month.key(),
            previous_month: month.previous().key(),
            next_month: month.next().key(),
            start_date: month.start_string(),
            end_date_exclusive: month.end_exclusive_string(),
            currency: "USD".to_string(),
            summary,
            overview,
            account_spend,
            latest_activity,
        })
    })
}

/// Trailing spend history for the Overview trend. The window ends at the
/// requested month (default: the current month) and is always zero-filled.
pub fn spend_history(
    state: &AppState,
    requested_end: Option<String>,
    months: Option<u32>,
) -> AppResult<SpendHistory> {
    let demo = state.mode() == SessionMode::Demo;
    state.with_db(|conn, _header, settings| {
        let today = if demo {
            crate::demo::demo_today()
        } else {
            dates::today(&settings.timezone).map_err(|_| AppError::InvalidInput("timezone"))?
        };
        let current_month = Month::from_date(today);
        let end = match requested_end.as_deref() {
            Some(value) if !value.is_empty() => {
                Month::parse(value).map_err(|_| AppError::InvalidInput("endMonth"))?
            }
            _ => current_month,
        };
        ledger_spend_history(conn, end, months.unwrap_or(12), current_month, "USD")
    })
}
