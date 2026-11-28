import type { PageRoute } from "../chat/pageStack";
import { useWindowField, type WindowModel } from "../clientState";
import type { Contributions } from "../extensions/contributions";
import type { ExtensionSummary } from "../extensions/ExtensionPage";
import type { ChatState } from "../chat/sessionStates";
import type { NotificationCounts } from "../notifications/model";
import { NotificationActions, type ChatEntry, type OpenApproval } from "../notifications/notificationActions";
import type { Notifier } from "../notifications/notifier";
import { PageDirectory } from "../notifications/pageDirectory";
import type { IgniClient } from "../protocol/client";
import { UpdateInfo } from "../update/updateInfo";
import { TRUST_DIALOG_KIND, isTrustStatus } from "../workspaceTrust/model";
import { FilePreview } from "./FilePreview";
import { HostDialog } from "./HostDialog";
import { LoginDialog } from "./LoginDialog";
import { NotificationsPanel } from "./NotificationsPanel";
import { DirectoryPicker } from "./panels/DirectoryPicker";
import { RetryBanner } from "./RetryBanner";
import { Toasts } from "./Toasts";
import { UpdatePrompt } from "./UpdatePrompt";
import { WorkspaceTrustDialog } from "./WorkspaceTrustDialog";

/**
 * Everything drawn over the window: the file preview, toasts, the retry
 * banner, the open dialog (``ui.dialog``) and the open panel
 * (``ui.panel``). Each is bound to the window model, so an extension
 * opening one is drawn the same way.
 */
export function AppOverlays({
  client,
  windowModel,
  notifier,
  contributions,
  extensions,
  projectDir,
  chats,
  chatStates,
  currentChat,
  approvals,
  pendingUpdate,
  onOpen,
  onOpenChat,
  onShowUpdate,
  onPickFolder,
  onCountsChanged,
  onSignedIn,
  onLoginFailed,
}: {
  client: IgniClient;
  windowModel: WindowModel;
  notifier: Pick<Notifier, "dismiss">;
  contributions: Contributions;
  extensions: ExtensionSummary[];
  projectDir: string;
  /** The chats, what each is doing, the one on screen and its open
   *  approvals: what a notification's decision is checked against. */
  chats: readonly ChatEntry[];
  chatStates: { of(sessionId: string): ChatState };
  currentChat: string;
  approvals: readonly OpenApproval[] | null;
  pendingUpdate: UpdateInfo | null;
  onOpen: (route: PageRoute) => void;
  onOpenChat: (sessionId: string) => void;
  onShowUpdate: (info: UpdateInfo) => void;
  onPickFolder: (dir: string) => void;
  onCountsChanged: (counts: NotificationCounts) => void;
  onSignedIn: (who: string) => void;
  onLoginFailed: (detail: string) => void;
}) {
  const preview = useWindowField(windowModel, "preview");
  const toasts = useWindowField(windowModel, "toasts");
  const dialog = useWindowField(windowModel, "dialog");
  const panel = useWindowField(windowModel, "panel")?.kind;
  const updateInfo = dialog ? UpdateInfo.fromDialogSpec(dialog.spec) : null;
  const extensionName = (id: string) => extensions.find((e) => e.id === id)?.name;

  // What a notification reaches, checked against what is there now:
  // rebuilt every render, so a decision answered elsewhere demotes its
  // card and loses its button at once.
  const actions = new NotificationActions(
    {
      chats,
      states: chatStates,
      currentChat,
      approvals,
      pages: new PageDirectory(contributions, extensions),
      update: pendingUpdate,
    },
    { openChat: onOpenChat, openPage: onOpen, showUpdate: onShowUpdate },
  );

  return (
    <>
      {preview && (
        <FilePreview client={client} path={preview.path} onClose={() => windowModel.write("preview", null)} />
      )}
      <Toasts
        items={toasts}
        onDismiss={(id) => notifier.dismiss(id)}
        actions={actions}
        sourceName={(id) => extensionName(id) ?? id}
      />
      <RetryBanner />
      {dialog && updateInfo && (
        <UpdatePrompt info={updateInfo.toWire()} onDismiss={() => windowModel.answerDialog(dialog.id, null)} />
      )}
      {dialog?.spec.kind === TRUST_DIALOG_KIND && isTrustStatus(dialog.spec) && (
        <WorkspaceTrustDialog
          key={dialog.id}
          client={client}
          status={dialog.spec}
          onClose={() => windowModel.answerDialog(dialog.id, null)}
        />
      )}
      {dialog?.spec.kind === "extension" && (
        <HostDialog
          key={dialog.id}
          dialog={dialog}
          sourceName={(dialog.source ? extensionName(dialog.source) : undefined) ?? dialog.source ?? ""}
          onAnswer={(answer) => windowModel.answerDialog(dialog.id, answer)}
        />
      )}
      {panel === "dir-picker" && (
        <DirectoryPicker
          client={client}
          title="Lock session to a project folder"
          initialPath={projectDir}
          onSelect={onPickFolder}
          onCancel={() => windowModel.closePanel()}
        />
      )}
      {panel === "notifications" && (
        <NotificationsPanel
          client={client}
          sourceName={(source) => extensionName(source) ?? source}
          actions={actions}
          // Marking something read moves every badge, and the push that
          // says so may land after the panel read the new counts — so
          // it reports what it read too.
          onCountsChanged={onCountsChanged}
          onClose={() => windowModel.closePanel()}
        />
      )}
      {panel === "login" && (
        <LoginDialog
          client={client}
          onClose={() => windowModel.closePanel()}
          onSignedIn={onSignedIn}
          onFailed={onLoginFailed}
        />
      )}
    </>
  );
}
