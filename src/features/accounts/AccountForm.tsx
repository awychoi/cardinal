import { useRef, useState, type FormEvent } from "react";
import {
  isDepositoryAccount,
  type Account,
  type AccountPayload,
  type AccountType,
} from "../../lib/bridge";
import { zAccountPayload } from "../../lib/bridge/contract";
import { Button } from "../../components/Button";

interface Props {
  initial?: Account | null;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (payload: AccountPayload) => Promise<void>;
  onCancel?: () => void;
}

type Errors = Partial<Record<keyof AccountPayload, string>>;
type FieldKey = keyof AccountPayload;

const FIELD_IDS: Record<FieldKey, string> = {
  issuer: "account-issuer",
  displayName: "account-display-name",
  lastFour: "account-last-four",
  accountType: "account-type",
  currency: "account-currency",
  creditLimit: "account-credit-limit",
  currentBalance: "account-current-balance",
  includeInOverview: "account-include",
};

const FIELD_LABELS: Record<FieldKey, string> = {
  issuer: "Issuer",
  displayName: "Display name",
  lastFour: "Last four digits",
  accountType: "Account type",
  currency: "Currency",
  creditLimit: "Credit limit",
  currentBalance: "Current balance",
  includeInOverview: "Include in overview totals",
};

const ERROR_ORDER: FieldKey[] = [
  "issuer",
  "displayName",
  "lastFour",
  "accountType",
  "currency",
  "creditLimit",
  "currentBalance",
  "includeInOverview",
];

/** Translate schema issues into copy a person can act on. */
function friendlyIssue(key: FieldKey, code: string): string {
  switch (key) {
    case "issuer":
      return code === "too_big"
        ? "Keep the issuer under 80 characters."
        : "Enter the issuer, for example Chase.";
    case "displayName":
      return code === "too_big"
        ? "Keep the display name under 120 characters."
        : "Enter a display name, for example Sapphire Reserve.";
    case "lastFour":
      return "Enter exactly four digits, or leave it blank.";
    case "accountType":
      return "Choose an account type.";
    case "currency":
      return "Use a three-letter currency code, for example USD.";
    case "creditLimit":
      return "Keep the credit limit under 40 characters.";
    case "currentBalance":
      return "Keep the current balance under 40 characters.";
    case "includeInOverview":
      return "Choose whether this account counts in overview totals.";
  }
}

export function AccountForm({ initial, submitLabel, busy, onSubmit, onCancel }: Props) {
  const [issuer, setIssuer] = useState(initial?.issuer ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [lastFour, setLastFour] = useState(initial?.lastFour ?? "");
  const [accountType, setAccountType] = useState<AccountType>(
    (initial?.accountType as AccountType | undefined) ?? "credit_card",
  );
  const [creditLimit, setCreditLimit] = useState(
    initial?.creditLimitMinor != null ? (initial.creditLimitMinor / 100).toFixed(2) : "",
  );
  const [currentBalance, setCurrentBalance] = useState("");
  const depository = isDepositoryAccount(accountType);
  const initialDepository = initial ? isDepositoryAccount(initial.accountType) : null;
  // Provider balances are owned by sync; only a manual account can accept a
  // new point-in-time balance here.
  const canEditBalance = !initial || initial.sourceKind === "manual";
  const [includeInOverview, setIncludeInOverview] = useState(initial?.includeInOverview ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | HTMLSelectElement | null>>>(
    {},
  );

  const errorKeys = ERROR_ORDER.filter((key) => Boolean(errors[key]));

  function clearError(key: FieldKey) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const candidate = {
      issuer,
      displayName,
      lastFour: lastFour.trim() === "" ? null : lastFour.trim(),
      accountType,
      currency: "USD",
      creditLimit: depository || creditLimit.trim() === "" ? null : creditLimit.trim(),
      currentBalance:
        depository && canEditBalance && currentBalance.trim() !== "" ? currentBalance.trim() : null,
      includeInOverview,
    };
    const parsed = zAccountPayload.safeParse(candidate);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in next)) {
          next[key as FieldKey] = friendlyIssue(key as FieldKey, issue.code);
        }
      }
      setErrors(next);
      const firstInvalid = ERROR_ORDER.find((key) => Boolean(next[key]));
      if (firstInvalid) {
        const focusFirst = () => fieldRefs.current[firstInvalid]?.focus();
        if (typeof window.requestAnimationFrame === "function")
          window.requestAnimationFrame(focusFirst);
        else window.setTimeout(focusFirst, 0);
      }
      return;
    }
    setErrors({});
    await onSubmit(parsed.data);
  }

  return (
    <form className="account-form" onSubmit={handleSubmit} noValidate>
      {errorKeys.length > 0 ? (
        <div className="form-error-summary" role="alert">
          <p id="account-form-error-title">
            Check {errorKeys.length === 1 ? "this field" : `these ${errorKeys.length} fields`}{" "}
            before saving.
          </p>
          <ul aria-labelledby="account-form-error-title">
            {errorKeys.map((key) => (
              <li key={key}>
                <a
                  href={`#${FIELD_IDS[key]}`}
                  onClick={(event) => {
                    event.preventDefault();
                    fieldRefs.current[key]?.focus();
                  }}
                >
                  {FIELD_LABELS[key]}
                </a>
                : {errors[key]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="form-grid">
        <label>
          <span className="field-label">
            Issuer
            <span className="field-required" aria-hidden="true">
              Required
            </span>
          </span>
          <input
            id={FIELD_IDS.issuer}
            ref={(element) => {
              fieldRefs.current.issuer = element;
            }}
            value={issuer}
            onChange={(event) => {
              setIssuer(event.target.value);
              clearError("issuer");
            }}
            maxLength={80}
            placeholder="Chase"
            aria-label="Issuer"
            aria-invalid={Boolean(errors.issuer)}
            aria-describedby={errors.issuer ? `${FIELD_IDS.issuer}-error` : undefined}
            required
          />
          {errors.issuer ? (
            <span className="field-error" id={`${FIELD_IDS.issuer}-error`}>
              {errors.issuer}
            </span>
          ) : null}
        </label>
        <label>
          <span className="field-label">
            Display name
            <span className="field-required" aria-hidden="true">
              Required
            </span>
          </span>
          <input
            id={FIELD_IDS.displayName}
            ref={(element) => {
              fieldRefs.current.displayName = element;
            }}
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              clearError("displayName");
            }}
            maxLength={120}
            placeholder="Sapphire Reserve"
            aria-label="Display name"
            aria-invalid={Boolean(errors.displayName)}
            aria-describedby={errors.displayName ? `${FIELD_IDS.displayName}-error` : undefined}
            required
          />
          {errors.displayName ? (
            <span className="field-error" id={`${FIELD_IDS.displayName}-error`}>
              {errors.displayName}
            </span>
          ) : null}
        </label>
        <label>
          <span className="field-label">Last four digits (optional)</span>
          <input
            id={FIELD_IDS.lastFour}
            ref={(element) => {
              fieldRefs.current.lastFour = element;
            }}
            value={lastFour}
            onChange={(event) => {
              setLastFour(event.target.value);
              clearError("lastFour");
            }}
            inputMode="numeric"
            maxLength={4}
            placeholder="1234"
            aria-label="Last four digits (optional)"
            aria-invalid={Boolean(errors.lastFour)}
            aria-describedby={errors.lastFour ? `${FIELD_IDS.lastFour}-error` : undefined}
          />
          {errors.lastFour ? (
            <span className="field-error" id={`${FIELD_IDS.lastFour}-error`}>
              {errors.lastFour}
            </span>
          ) : null}
        </label>
        <label>
          <span className="field-label">
            Account type
            <span className="field-required" aria-hidden="true">
              Required
            </span>
          </span>
          <select
            id={FIELD_IDS.accountType}
            ref={(element) => {
              fieldRefs.current.accountType = element;
            }}
            value={accountType}
            onChange={(event) => {
              setAccountType(event.target.value as AccountPayload["accountType"]);
              clearError("accountType");
            }}
            aria-label="Account type"
            aria-required="true"
            aria-invalid={Boolean(errors.accountType)}
            aria-describedby={errors.accountType ? `${FIELD_IDS.accountType}-error` : undefined}
          >
            {initialDepository === true ? (
              <>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="depository">Bank account (other)</option>
              </>
            ) : (
              <>
                <option value="credit_card">Credit card</option>
                <option value="charge_card">Charge card</option>
                <option value="line_of_credit">Line of credit</option>
                {initialDepository === null ? (
                  <>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="depository">Bank account (other)</option>
                  </>
                ) : null}
                <option value="other">Other</option>
              </>
            )}
          </select>
          {errors.accountType ? (
            <span className="field-error" id={`${FIELD_IDS.accountType}-error`}>
              {errors.accountType}
            </span>
          ) : null}
        </label>
        <label>
          <span className="field-label">Currency</span>
          <input
            id={FIELD_IDS.currency}
            ref={(element) => {
              fieldRefs.current.currency = element;
            }}
            value="USD"
            readOnly
            aria-readonly="true"
            aria-label="Currency"
          />
        </label>
        {depository ? (
          canEditBalance ? (
            <label>
              <span className="field-label">
                {initial ? "Update current balance (optional)" : "Current balance (optional)"}
              </span>
              <input
                id={FIELD_IDS.currentBalance}
                ref={(element) => {
                  fieldRefs.current.currentBalance = element;
                }}
                value={currentBalance}
                onChange={(event) => {
                  setCurrentBalance(event.target.value);
                  clearError("currentBalance");
                }}
                placeholder={initial ? "Leave blank to keep the latest" : "5,200.00"}
                inputMode="decimal"
                aria-label={
                  initial ? "Update current balance (optional)" : "Current balance (optional)"
                }
                aria-invalid={Boolean(errors.currentBalance)}
                aria-describedby={
                  errors.currentBalance ? `${FIELD_IDS.currentBalance}-error` : undefined
                }
              />
              {errors.currentBalance ? (
                <span className="field-error" id={`${FIELD_IDS.currentBalance}-error`}>
                  {errors.currentBalance}
                </span>
              ) : null}
            </label>
          ) : (
            <p className="fine-print account-balance-note">
              Balances for linked bank accounts arrive in Rust during sync and cannot be typed here.
            </p>
          )
        ) : (
          <label>
            <span className="field-label">Credit limit (optional)</span>
            <input
              id={FIELD_IDS.creditLimit}
              ref={(element) => {
                fieldRefs.current.creditLimit = element;
              }}
              value={creditLimit}
              onChange={(event) => {
                setCreditLimit(event.target.value);
                clearError("creditLimit");
              }}
              placeholder="12,500.00"
              inputMode="decimal"
              aria-label="Credit limit (optional)"
              aria-invalid={Boolean(errors.creditLimit)}
              aria-describedby={errors.creditLimit ? `${FIELD_IDS.creditLimit}-error` : undefined}
            />
            {errors.creditLimit ? (
              <span className="field-error" id={`${FIELD_IDS.creditLimit}-error`}>
                {errors.creditLimit}
              </span>
            ) : null}
          </label>
        )}
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={includeInOverview}
          onChange={(event) => {
            setIncludeInOverview(event.target.checked);
            clearError("includeInOverview");
          }}
        />
        Include in overview totals
      </label>
      <div className="button-row">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
