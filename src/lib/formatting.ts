/** Presentation-only formatting. Financial rules and totals are backend-owned. */

export function formatMoney(minor: number, currency = "USD"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/** A signed amount with a true minus sign, for headline figures. */
export function formatSignedMoney(minor: number, currency = "USD"): string {
  const amount = formatMoney(Math.abs(minor), currency);
  return minor < 0 ? `−${amount}` : amount;
}

export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateOnly(value: string): string {
  return parseDateOnly(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(value: string): string {
  return parseDateOnly(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatMonthRange(start: string, endExclusive: string): string {
  const end = parseDateOnly(endExclusive);
  end.setDate(end.getDate() - 1);
  return `${formatDateShort(start)} – ${end.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function monthLabel(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** Short month for dense chart axes; the year is in the chart caption. */
export function monthShortLabel(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value - 1, 1).toLocaleDateString(undefined, { month: "short" });
}

export function dueAmountLabel(kind: string, amountMinor: number | null, currency: string): string {
  switch (kind) {
    case "minimum_due":
      // A minimum-due kind without an amount is a contract violation, not a
      // known $0.00. Keep it unknown rather than inventing a zero.
      return amountMinor === null
        ? "amount not reported"
        : `${formatMoney(amountMinor, currency)} minimum`;
    case "reported_zero":
      return `${formatMoney(0, currency)} reported`;
    case "not_reported":
      return "amount not reported";
    default:
      return "no due date reported";
  }
}

export function connectionLabel(status: string | null, sourceKind: string): string {
  if (sourceKind === "manual") return "Manual";
  switch (status) {
    case "healthy":
      return "Connected";
    case "reconnect_required":
      return "Reconnect needed";
    case "error":
      return "Sync error";
    case "disconnected":
      return "Disconnected";
    default:
      return "Connection unknown";
  }
}
