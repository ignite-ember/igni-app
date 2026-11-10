/**
 * Builds the window's chat controllers once, from collaborators that
 * never change identity, and wires them to each other.
 *
 * Nothing here closes over render-time state: what a controller needs to
 * read (the items, the phase, the session) it reads through the
 * transcript view, the run controls or the window model at the moment
 * it acts. So none of them can act on a stale value, and the handler
 * object the transcript rows get is the same object for the window's
 * life — ``ChatItemView``'s memo keeps hitting while tokens stream.
 */

import { useMemo } from "react";

import type { WindowModel } from "../clientState";
import type { ChatItemHandlers } from "../components/chatItems/handlers";
import type { Notifier } from "../notifications/notifier";
import type { IgniClient } from "../protocol/client";
import type { HistoryLoader } from "./historyLoader";
import type { HitlRequests } from "./hitlRequests";
import { ItemActions } from "./itemActions";
import { MessageSubmitter } from "./messageSubmitter";
import { MirrorEventRouter } from "./mirrorEventRouter";
import type { PushChannelRouter } from "./pushChannelRouter";
import { RunStreamer } from "./runStreamer";
import { SessionSwitcher } from "./sessionSwitcher";
import type { ShellPort } from "./shellPort";
import { SlashCommandRouter } from "./slashCommandRouter";
import { StreamEventRouter } from "./streamEventRouter";
import { TranscriptEdits } from "./transcriptEdits";
import type { TranscriptView } from "./transcriptView";
import type { RunControls } from "./useRunPhase";
import type { WorkflowLauncher } from "./workflowLauncher";

export interface ChatControllerDeps {
  client: IgniClient;
  windowModel: WindowModel;
  view: TranscriptView;
  hitl: HitlRequests;
  run: RunControls;
  historyLoader: HistoryLoader;
  workflows: WorkflowLauncher;
  notifier: Notifier;
  pushRouter: PushChannelRouter;
  shell: ShellPort;
}

/** The approval form's decisions, as the run resumes with them. */
type HitlAnswers = Parameters<RunStreamer["resume"]>[0];

export interface ChatController {
  streamer: RunStreamer;
  commands: SlashCommandRouter;
  sessions: SessionSwitcher;
  mirror: MirrorEventRouter;
  submitter: MessageSubmitter;
  handlers: ChatItemHandlers;
  /** The approval form's answer: the requests close, the run resumes. */
  resolveHitl: (decisions: HitlAnswers) => void;
}

function wireChatController(deps: ChatControllerDeps): ChatController {
  const { client, windowModel, view, hitl, run, historyLoader, workflows, notifier, pushRouter, shell } =
    deps;
  const streamEvents = new StreamEventRouter({
    client,
    view,
    hitl,
    run,
    shell,
    // The commands router is built below; this runs only once a stream
    // has ended, long after.
    revertAutoAccept: () => void commands.run("/accept off", false),
  });
  const onEvent = streamEvents.route.bind(streamEvents);
  const streamer = new RunStreamer({ client, view, run, shell, notifier, onEvent });
  const sessions = new SessionSwitcher({ client, windowModel, view, historyLoader, shell });
  const commands = new SlashCommandRouter({
    client,
    view,
    run,
    streamer,
    sessions,
    workflows,
    windowModel,
    shell,
    onEvent,
  });
  const mirror = new MirrorEventRouter({ client, view, hitl, run, shell, pushRouter });
  const submitter = new MessageSubmitter({ client, view, run, commands, streamer });
  const edits = new TranscriptEdits({ client, view, streamer, windowModel, shell });
  const items = new ItemActions({ client, view, streamer, workflows });
  const handlers: ChatItemHandlers = {
    user: { edit: edits.editUser, delete: edits.deleteUser },
    team: { stopTeam: run.cancel, stopAgent: items.stopAgent, retryAgent: items.retryAgent },
    plan: { approve: items.approvePlan, reject: items.rejectPlan },
    interrupted: {
      retry: edits.retryInterrupted,
      discard: edits.discardInterrupted,
      editPrompt: edits.editPrompt,
    },
    workflow: { rerun: items.rerunWorkflow, cancel: items.cancelWorkflow },
    visualization: { dispatchAction: items.dispatchVisualizationAction },
  };
  const resolveHitl = (decisions: HitlAnswers): void => {
    hitl.clear();
    void streamer.resume(decisions);
  };
  return { streamer, commands, sessions, mirror, submitter, handlers, resolveHitl };
}

/** Every member of ``deps`` must keep its identity for the window's
 *  life; one that does not rebuilds every controller. */
export function useChatController(deps: ChatControllerDeps): ChatController {
  const { client, windowModel, view, hitl, run, historyLoader, workflows, notifier, pushRouter, shell } =
    deps;
  return useMemo(
    () =>
      wireChatController({
        client,
        windowModel,
        view,
        hitl,
        run,
        historyLoader,
        workflows,
        notifier,
        pushRouter,
        shell,
      }),
    [client, windowModel, view, hitl, run, historyLoader, workflows, notifier, pushRouter, shell],
  );
}
