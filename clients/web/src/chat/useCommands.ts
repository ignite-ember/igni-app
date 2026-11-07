/**
 * The commands the composer offers: the session's skills, the slash
 * commands the backend dispatches, and the signal that opens the model
 * menu (``/model``). Running one is ``SlashCommandRouter``'s.
 */

import { useCallback, useState } from "react";

import type { IgniClient } from "../protocol/client";
import { SlashCommandCatalog, type SlashCommand } from "./slashCommands";

export interface CommandsState {
  skills: SlashCommand[];
  /** ``null`` until the backend answers (or for one too old to have
   *  the RPC): the composer falls back to its built-in list. */
  backendCommands: SlashCommand[] | null;
  modelMenuSignal: { n: number } | null;
  /** Ask the bound session for both lists. Never throws. */
  loadCatalog: () => Promise<void>;
  openModelMenu: () => void;
}

export function useCommands(client: Pick<IgniClient, "rpc">): CommandsState {
  const [skills, setSkills] = useState<SlashCommand[]>([]);
  const [backendCommands, setBackendCommands] = useState<SlashCommand[] | null>(null);
  const [modelMenuSignal, setModelMenuSignal] = useState<{ n: number } | null>(null);

  const loadCatalog = useCallback(async () => {
    try {
      setSkills(SlashCommandCatalog.fromSkillDefinitions(await client.rpc<unknown>("get_skill_definitions")));
    } catch {
      /* skills optional */
    }
    try {
      const cmds = SlashCommandCatalog.fromBackendCommands(await client.rpc<unknown>("get_slash_commands"));
      if (cmds.length) setBackendCommands(cmds);
    } catch {
      /* older backend — the composer's fallback covers it */
    }
  }, [client]);

  const openModelMenu = useCallback(() => setModelMenuSignal({ n: Date.now() }), []);

  return { skills, backendCommands, modelMenuSignal, loadCatalog, openModelMenu };
}
