import { useMemo, type RefObject } from "react";

import type { RunSettingsSwitcher } from "../chat/runSettingsSwitcher";
import type { ShellActions } from "../chat/shellActions";
import type { CommandsState } from "../chat/useCommands";
import type { HitlState } from "../chat/useHitl";
import type { RunPhaseState } from "../chat/useRunPhase";
import type { WindowModel } from "../clientState";
import type { BackendSnapshot } from "../cloud/backendState";
import type { Contributions } from "../extensions/contributions";
import type { IgniClient } from "../protocol/client";
import type { ChatController } from "../chat/useChatController";
import type { StatusUpdate } from "../protocol/messages";
import { ComposerDock } from "./ComposerDock";
import type { SessionContextActions } from "./StatusBits";
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
  run: Pick<RunPhaseState, "runPhase" | "controls" | "processing">;
  commands: Pick<CommandsState, "skills" | "backendCommands" | "modelMenuSignal">;
  contributions: Pick<Contributions, "tools">;
  hitl: Pick<HitlState, "pending" | "stop">;
  onResolveHitl: ChatController["resolveHitl"];
  actions: Pick<
    ShellActions,
    "runCommand" | "submit" | "compact" | "openContext" | "newChat" | "fork"
  >;
  switcher: RunSettingsSwitcher;
  /** The dock under the composer: where igni runs, the folder, and the
   *  session + its context. */
  backend: BackendSnapshot | null;
  projectDir: string;
  onPickProject: () => void;
  sessionId: string;
  /** Before a line is sent: bring the transcript to its end, so the person
   *  sees what they sent and the answer to it. After a long reply the list
   *  can have stopped following, and the new turn landed out of view. */
  onSend?: () => void;
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
  backend,
  projectDir,
  onPickProject,
  sessionId,
  onSend,
}: AppComposerProps) {
  const permissionMode = status?.permission_mode;
  const { controls } = run;
  // Stop is Escape: with an approval waiting it rejects them all and
  // cancels, otherwise it cancels.
  const { stop } = hitl;
  const composerActions = useMemo<ComposerActions>(
    () => ({
      onPickModel: (name) => void switcher.pickModel(name),
      onTool: actions.runCommand,
      onSubmit: (text) => {
        onSend?.();
        actions.submit(text);
      },
      onStop: stop,
      onPickMode: (mode) => switcher.pickMode(permissionMode, mode),
    }),
    [switcher, actions, stop, permissionMode, onSend],
  );
  const contextActions = useMemo<SessionContextActions>(
    () => ({
      compact: actions.compact,
      openContext: actions.openContext,
      clear: actions.newChat,
      fork: actions.fork,
    }),
    [actions],
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
      dockSlot={
        <ComposerDock
          backend={backend}
          projectDir={projectDir}
          onPickProject={onPickProject}
          sessionId={sessionId}
          status={status}
          permissionMode={permissionMode}
          onPickMode={composerActions.onPickMode}
          contextActions={contextActions}
          busy={run.processing}
        />
      }
    />
  );
}
