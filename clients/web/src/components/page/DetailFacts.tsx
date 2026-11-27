/** Short facts about a thing — where it lives, its version, its pid —
 *  as label/value rows. A value is set in mono only when it is a path,
 *  a command or an id (`mono`). Put it inside a {@link DetailSection}. */

import type { ReactNode } from "react";

export interface DetailFact {
  label: string;
  value: ReactNode;
  /** A path, command or id: set in mono. */
  mono?: boolean;
}

export function DetailFacts({ facts }: { facts: readonly (DetailFact | false | null | undefined)[] }) {
  const shown = facts.filter((f): f is DetailFact => !!f);
  if (shown.length === 0) return null;
  return (
    <dl className="detail-facts">
      {shown.map((f) => (
        <div className="detail-fact" key={f.label}>
          <dt>{f.label}</dt>
          <dd className={f.mono ? "is-mono" : undefined}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
