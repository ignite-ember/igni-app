/**
 * Switching the run's model and permission mode from the composer.
 *
 * Both go straight to the backend: a choice made in the UI needs no
 * chat line. A refused switch is an expected failure, carried back as a
 * result and shown in the transcript in the words it has always used.
 */

import { modeSwitch, type PermissionMode } from "../components/composer/permissionModes";
import type { IgniClient } from "../protocol/client";
import { failureReason, type Failure } from "../protocol/composerWire";
import type { ServerMessage } from "../protocol/messages";
import type { TranscriptView } from "./transcriptView";

export interface RunSettingsSwitcherDeps {
  client: Pick<IgniClient, "switchModel" | "handleCommand">;
  view: Pick<TranscriptView, "info" | "error">;
  refreshStatus: () => Promise<void>;
}

type SwitchOutcome = { ok: true; reply: ServerMessage } | Failure;

export class RunSettingsSwitcher {
  constructor(private readonly deps: RunSettingsSwitcherDeps) {}

  /** The backend's acknowledgement is shown, then the footer catches up. */
  pickModel = async (name: string): Promise<void> => {
    const { client, view, refreshStatus } = this.deps;
    const outcome = await settle(() => client.switchModel(name), String);
    if (!outcome.ok) {
      view.error(outcome.reason);
      return;
    }
    if (outcome.reply.type === "info") view.info(outcome.reply.text);
    void refreshStatus();
  };

  /**
   * Flip the backend through its slash command. ``current`` is the mode
   * the status reports as the pick is made; picking it again does
   * nothing. The ``permission_mode_changed`` push moves the badge.
   *
   * A mode the backend cannot leave from where it is — ``dontAsk`` has
   * no command — is said so rather than dropped: the pick would
   * otherwise look like it did nothing.
   */
  pickMode = (current: string | undefined, next: PermissionMode): void => {
    const { client, view } = this.deps;
    const request = modeSwitch(current, next);
    if (request.kind === "unchanged") return;
    if (request.kind === "unreachable") {
      view.info(
        `The backend runs in ${request.from}; igni has no command to leave that mode.`,
      );
      return;
    }
    void settle(() => client.handleCommand(request.command), failureReason).then((outcome) => {
      if (!outcome.ok) view.error(`Mode switch failed: ${outcome.reason}`);
    });
  };
}

/** A request whose rejection is an expected outcome, as a result. */
async function settle(
  request: () => Promise<ServerMessage>,
  reasonOf: (e: unknown) => string,
): Promise<SwitchOutcome> {
  try {
    return { ok: true, reply: await request() };
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}
