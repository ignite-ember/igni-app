import { useCallback, useEffect, useMemo, useState } from "react";
import type { IgniClient } from "../../protocol/client";
import { PageHeaderControls } from "../page/PageHeaderControls";
import { Drawer } from "./Drawer";
import { AgentDetailPage } from "./agents/AgentDetailPage";
import type { KeepChoice } from "./agents/AgentKeepActions";
import { AgentsList } from "./agents/AgentsList";
import {
  ALL_SOURCES,
  SORT_OPTIONS,
  sourceFilterOptions,
  visibleAgents,
  type AgentRow,
  type AgentSort,
} from "./agents/agentRecord";

/** Agent pool: a card grid with search, a source filter and a sort,
 *  each agent's own page one level down, and keep or discard for the
 *  agents made during this session. */
export function AgentsPanel({
  client,
  onClose,
}: {
  client: IgniClient;
  onClose: () => void;
}) {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  // By name, so a refresh shows the agent as it now is — and a
  // discarded one drops back to the list.
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>(ALL_SOURCES);
  const [sort, setSort] = useState<AgentSort>("name");

  const refresh = useCallback(async () => {
    try {
      setAgents((await client.rpc<AgentRow[]>("get_agent_details")) || []);
    } catch (e) {
      console.error(e);
      setAgents([]);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected =
    selectedName === null ? null : (agents?.find((a) => (a.name ?? "") === selectedName) ?? null);

  const keep = async (agent: AgentRow, choice: KeepChoice) => {
    const name = agent.name || "";
    setBusy(name);
    try {
      if (choice === "discard") await client.rpc("discard_ephemeral_agent", { name });
      else await client.rpc("promote_ephemeral_agent", { name, target: choice });
      await refresh();
    } finally {
      setBusy("");
    }
  };

  const filterOptions = useMemo(() => sourceFilterOptions(agents ?? []), [agents]);
  const visible = useMemo(
    () => visibleAgents(agents ?? [], query, source, sort),
    [agents, query, source, sort],
  );

  const controls =
    selected === null && agents !== null && agents.length > 0 ? (
      <PageHeaderControls
        search={{
          value: query,
          onChange: setQuery,
          placeholder: "Search agents…",
          label: "Search agents",
        }}
        filter={
          filterOptions.length > 2
            ? { options: filterOptions, current: source, onPick: setSource, label: "Source" }
            : undefined
        }
        sort={{ options: SORT_OPTIONS, current: sort, onPick: setSort }}
      />
    ) : null;

  return (
    <Drawer
      // The selected agent is a level on the page's trail, not a
      // second trail in the title.
      levels={{
        // An agent without a name is a malformed definition rather than
        // an impossible one; label it so the trail still moves.
        labels: selected ? [selected.name || "Agent"] : [],
        onTruncate: () => setSelectedName(null),
      }}
      title="Agents"
      // The agent's page opens with its own name in the hero.
      titleInBody={selected !== null}
      headerExtras={controls}
      onClose={onClose}
    >
      {selected ? (
        <AgentDetailPage
          agent={selected}
          busy={busy === (selected.name || "")}
          onKeep={(choice) => void keep(selected, choice)}
        />
      ) : (
        <AgentsList
          agents={agents}
          visible={visible}
          busy={busy}
          onOpen={(a) => setSelectedName(a.name ?? "")}
          onKeep={(a, choice) => void keep(a, choice)}
        />
      )}
    </Drawer>
  );
}
