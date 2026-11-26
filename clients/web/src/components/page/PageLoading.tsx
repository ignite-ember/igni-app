/** A page's first read, still in flight: one quiet line where the
 *  content will be, announced to assistive technology. */

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="icon-spinner" aria-hidden="true" />
      {label}
    </div>
  );
}
