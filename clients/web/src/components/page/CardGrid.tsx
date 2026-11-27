/** Cards two to a row (one on a narrow window). `flow` packs them as
 *  masonry — each card keeps its own height — for cards that differ in
 *  height or grow when opened. */

import type { ReactNode } from "react";

import { useMasonry } from "../panels/useMasonry";

export function CardGrid({
  flow = false,
  className,
  children,
}: {
  flow?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return flow ? (
    <FlowGrid className={className}>{children}</FlowGrid>
  ) : (
    <div className={className ? `card-grid ${className}` : "card-grid"}>{children}</div>
  );
}

function FlowGrid({ className, children }: { className?: string; children: ReactNode }) {
  const flow = useMasonry();
  return (
    <div className={`card-grid card-grid--flow${className ? ` ${className}` : ""}`} ref={flow}>
      {children}
    </div>
  );
}
