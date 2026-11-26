/** What a page shows when it has nothing to list: a bold line, a muted
 *  hint, and at most one way forward, centred in the page. */

import type { ReactNode } from "react";

export function PageEmpty({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  /** One button or link under the hint. */
  action?: ReactNode;
}) {
  return (
    <div className="page-empty">
      <div className="page-empty-title">{title}</div>
      {hint && <div className="page-empty-hint">{hint}</div>}
      {action && <div className="page-empty-action">{action}</div>}
    </div>
  );
}
