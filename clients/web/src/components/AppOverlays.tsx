import type { PageRoute } from "../chat/pageStack";
import { useWindowField, type WindowModel } from "../clientState";
import type { Contributions } from "../extensions/contributions";
import type { ExtensionSummary } from "../extensions/ExtensionPage";
import type { NotificationCounts, NotificationTarget } from "../notifications/model";
import type { Notifier } from "../notifications/notifier";
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
  onOpen,
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
  onOpen: (route: PageRoute) => void;
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

  // The extension's own page, with the notification's params: the door
  // its sidebar entry opens, so it reads where to go from its launch params.
  const openTarget = (target: NotificationTarget) => {
    const owner = contributions.pages.ownerOf(target.page);
    const extension = extensions.find((e) => e.id === owner);
    const label =
      extension?.pages.find((p) => p.kind === target.page)?.label ??
      contributions.sidebar().find((l) => l.kind === target.page)?.label ??
      target.page;
    onOpen({ kind: target.page, label, params: target.params });
  };

  return (
    <>
      {preview && (
        <FilePreview client={client} path={preview.path} onClose={() => windowModel.write("preview", null)} />
      )}
      <Toasts items={toasts} onDismiss={(id) => notifier.dismiss(id)} onOpen={onOpen} />
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
          canOpen={(kind) => contributions.pages.has(kind)}
          // Marking something read moves every badge, and the push that
          // says so may land after the panel read the new counts — so
          // it reports what it read too.
          onCountsChanged={onCountsChanged}
          onOpenTarget={openTarget}
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
