/** The Hooks page's three glyphs: an event, a script, a webhook. */

export function EventIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M9 1.8 3.8 9h4l-1 5.2L12.2 7h-4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function ScriptIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M3 2.5h7.5L13 5v8.5H3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function WebhookIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="5.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M7.6 6.8l2.6 3.4M5.4 6.6L4.6 10.4M5.6 12.6h4.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
