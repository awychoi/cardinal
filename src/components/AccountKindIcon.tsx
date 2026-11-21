/**
 * A tiny, consistent mark for the two sides of the balance sheet.
 *
 * Cash accounts get a bank/column glyph and credit accounts a card glyph so
 * bank accounts read as peers of cards at a glance. Purely decorative; every
 * caller supplies a text label beside it.
 */
export function AccountKindIcon({
  kind,
  className = "",
}: {
  kind: "cash" | "card";
  className?: string;
}) {
  if (kind === "cash") {
    return (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        className={className}
        aria-hidden="true"
      >
        <path d="M2.6 8.2 10 3.2l7.4 5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.1 8.2v7.2h11.8V8.2" strokeLinejoin="round" />
        <path d="M6.5 9.8v4M10 9.8v4M13.5 9.8v4M3.4 16.6h13.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.3" y="4.6" width="15.4" height="10.8" rx="2.2" />
      <path d="M2.3 8.1h15.4" />
      <path d="M5.3 12.8h3.1" strokeLinecap="round" />
    </svg>
  );
}
