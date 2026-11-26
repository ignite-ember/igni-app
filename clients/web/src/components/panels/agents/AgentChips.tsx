/** An agent's soft chips on its card: whether it can orchestrate other
 *  agents, and its first tags. Where it comes from is the footer's. */

import { HeroChip } from "../../page/HeroChip";
import type { AgentRow } from "./agentRecord";

/** Tags drawn on a card before the rest fold into "+N more". */
const CARD_TAGS = 3;

export function AgentChips({ agent }: { agent: AgentRow }) {
  const tags = agent.tags ?? [];
  return (
    <>
      {agent.can_orchestrate && <HeroChip>orchestrates</HeroChip>}
      {tags.slice(0, CARD_TAGS).map((t) => (
        <HeroChip key={t}>{t}</HeroChip>
      ))}
      {tags.length > CARD_TAGS && <HeroChip>+{tags.length - CARD_TAGS} more</HeroChip>}
    </>
  );
}
