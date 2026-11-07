import { useMemo, type RefObject } from "react";

import type { RunSettingsSwitcher } from "../chat/runSettingsSwitcher";
import type { ShellActions } from "../chat/shellActions";
import type { CommandsState } from "../chat/useCommands";
import type { HitlState } from "../chat/useHitl";
import type { RunPhaseState } from "../chat/useRunPhase";
import type { WindowModel } from "../clientState";
import type { Contributions } from "../extensions/contributions";
import type { IgniClient } from "../protocol/client";
import type { ChatController } from "../chat/useChatController";
import type { StatusUpdate } from "../protocol/messages";
import { Composer } from "./composer/Composer";
import type { ComposerActions, ComposerCatalog, ComposerHandle } from "./composer/composerContract";
import { HitlDialog } from "./HitlDialog";

export interface AppComposerProps {
  composerRef: RefObject<ComposerHandle | null>;
  client: IgniClient;
  windowModel: WindowModel;
  /** Connected and bound to a session. */
  ready: boolean;
  brandName: string;
  status: StatusUpdate | null;
  run: Pick<RunPhaseState, "runPhase" | "cancel" | "controls">;
  commands: Pick<CommandsState, "skills" | "backendCommands" | "modelMenuSignal">;
  contributions: Pick<Contributions, "tools">;
  hitl: Pick<HitlState, "pending">;
  onResolveHitl: ChatController["resolveHitl"];
  actions: Pick<ShellActions, "runCommand" | "submit">;
  switcher: RunSettingsSwitcher;
}

/** The composer, with the approval form rising out of it while a run
 *  waits on one. */
export function AppComposer({
  composerRef,
  client,
  windowModel,
  ready,
  brandName,
  status,
  run,
  commands,
  contributions,
  hitl,
  onResolveHitl,
  actions,
  switcher,
}: AppComposerProps) {
  const permissionMode = status?.permission_mode;
  const { cancel, controls } = run;
  const composerActions = useMemo<ComposerActions>(
    () => ({
      onPickModel: (name) => void switcher.pickModel(name),
      onTool: actions.runCommand,
      onSubmit: actions.submit,
      onStop: cancel,
      onPickMode: (mode) => switcher.pickMode(permissionMode, mode),
    }),
    [switcher, actions, cancel, permissionMode],
  );
  // Read every render: the tools menu fills in place as extensions
  // install.
  const catalog: ComposerCatalog = {
    skills: commands.skills,
    backendCommands: commands.backendCommands,
    tools: contributions.tools(),
  };
  return (
    <Composer
      brandName={brandName}
      hitlSlot={
        hitl.pending ? (
          <HitlDialog
            requirements={hitl.pending}
            onResolve={onResolveHitl}
            currentMode={permissionMode}
            onAcceptEditsThisRun={controls.acceptEditsForThisRun}
          />
        ) : null
      }
      ref={composerRef}
      client={client}
      connected={ready}
      runPhase={run.runPhase}
      catalog={catalog}
      actions={composerActions}
      windowModel={windowModel}
      model={status?.model}
      modelMenuSignal={commands.modelMenuSignal}
      permissionMode={permissionMode}
    />
  );
}
