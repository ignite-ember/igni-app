/**
 * What the person does to the shell around the chat — pick a folder, a
 * session, a command, sign in — as methods on one object built once per
 * window. Every method is arrow-bound, so a handler the shell hands its
 * children keeps its identity across renders.
 *
 * Nothing here closes over render-time state: the folder is read from
 * the window model when the picker opens.
 */

import type { WindowModel } from "../clientState";
import type { PageServices } from "../components/AppPages";
import type { IgniClient } from "../protocol/client";
import type { ComposerSeeder } from "./composerSeeder";
import type { ProjectFolderPicker } from "./projectFolderPicker";
import type { TranscriptView } from "./transcriptView";
import type { ChatController } from "./useChatController";
import type { WindowNavigator } from "./windowNavigator";

export interface ShellActionsDeps {
  client: IgniClient;
  windowModel: Pick<WindowModel, "get" | "openPanel">;
  view: Pick<TranscriptView, "info" | "error">;
  controller: Pick<ChatController, "commands" | "sessions" | "submitter" | "streamer">;
  folderPicker: Pick<ProjectFolderPicker, "pick">;
  navigator: Pick<WindowNavigator, "closePages">;
  seeder: Pick<ComposerSeeder, "seed">;
  refreshStatus: () => Promise<void>;
}

/** The parts of {@link PageServices} that change while the window lives. */
export type PageServiceData = Pick<
  PageServices,
  "extensions" | "setExtensions" | "skills" | "maxContext"
>;

export class ShellActions {
  constructor(private readonly deps: ShellActionsDeps) {}

  /** The native dialog when there is one; otherwise the in-app picker. */
  pickProject = async (): Promise<void> => {
    const { folderPicker, windowModel, controller } = this.deps;
    const pick = await folderPicker.pick(windowModel.get("project_dir"));
    if (pick.kind === "picked") void controller.sessions.attachFolder(pick.path);
    else if (pick.kind === "in-app") windowModel.openPanel("dir-picker");
  };

  /** A slash command run for the person, with no chat line of its own. */
  runCommand = (cmd: string): void => {
    void this.deps.controller.commands.run(cmd, false);
  };

  newChat = (): void => this.runCommand("/clear");

  logOut = (): void => this.runCommand("/logout");

  submit = (text: string): void => {
    void this.deps.controller.submitter.submit(text);
  };

  attachFolder = (dir: string): void => {
    void this.deps.controller.sessions.attachFolder(dir);
  };

  pickSession = (id: string): void => {
    void this.deps.controller.sessions.pick(id);
  };

  openLogin = (): void => this.deps.windowModel.openPanel("login");

  signedIn = (who: string): void => {
    this.deps.view.info(`Logged in as ${who}`);
    void this.deps.refreshStatus();
  };

  loginFailed = (detail: string): void => {
    this.deps.view.error(`Login failed: ${detail}`);
    void this.deps.refreshStatus();
  };

  /** Behind the sign-in wall nothing has changed to refresh. */
  wallLoginFailed = (detail: string): void => {
    this.deps.view.error(`Login failed: ${detail}`);
  };

  /** What a page may do to the window: every action that leaves the
   *  page goes back to the chat first. */
  pageServices = (live: PageServiceData): PageServices => {
    const { client, navigator, seeder, controller } = this.deps;
    return {
      client,
      close: navigator.closePages,
      seed: (text) => {
        navigator.closePages();
        seeder.seed(text);
      },
      compact: () => {
        navigator.closePages();
        this.runCommand("/compact");
      },
      resumeLoop: (prompt) => {
        navigator.closePages();
        void controller.streamer.sendLoopIteration(prompt);
      },
      ...live,
    };
  };
}
