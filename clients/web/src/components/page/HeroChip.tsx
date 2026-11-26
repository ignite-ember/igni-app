/** One soft neutral chip in an {@link EntityHero}'s chip row — a source,
 *  a capability, an argument hint. Every hero's chips look alike. */

import type { ReactNode } from "react";

export function HeroChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="hero-chip" title={title}>
      {children}
    </span>
  );
}
