import type { AccountCard } from "../../lib/bridge";
import { dueAmountLabel, formatDateOnly } from "../../lib/formatting";

/**
 * Due date and amount for a card, in one line.
 *
 * A reported date that has already passed is common — Plaid repeats the last
 * statement's due date until the issuer refreshes it. Because due dates repeat
 * monthly, the backend rolls the reported day forward and returns it as
 * `estimatedNextDueDate`. That estimate is labelled `Est.` and never carries the
 * reported minimum: that amount belonged to the cycle whose date just expired.
 */
export function dueText(account: AccountCard, compact = false): string {
  const payment = account.payment;
  const dueDate = payment.estimatedNextDueDate ?? payment.nextDueDate;
  if (!dueDate) {
    return payment.dueAmountKind === "no_due_date"
      ? "No due date reported"
      : dueAmountLabel(payment.dueAmountKind, payment.dueAmountMinor, account.currency);
  }
  const full = formatDateOnly(dueDate);
  const date = compact ? full.replace(/,\s*\d{4}$/, "") : full;
  if (payment.estimatedNextDueDate) return `Est. ${date} · amount not reported`;
  const amount = dueAmountLabel(payment.dueAmountKind, payment.dueAmountMinor, account.currency);
  return `${date} · ${amount}`;
}
