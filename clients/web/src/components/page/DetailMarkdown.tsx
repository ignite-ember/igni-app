/** A markdown body on a detail page — a README, a skill's instructions,
 *  an agent's system prompt — in the one prose style every page shares.
 *  The renderer is the caller's (a README needs the sanitizing one). */

import type { ReactNode } from "react";

export function DetailMarkdown({ children }: { children: ReactNode }) {
  return <div className="detail-md">{children}</div>;
}
