import type { Panel } from "../clientState";
import type { IgniClient } from "../protocol/client";
import { LoginDialog } from "./LoginDialog";
import { SignInWall } from "./SignInWall";

export interface SignedOutAppProps {
  client: IgniClient;
  /** ``ui.panel``: the login dialog is drawn while it is ``login``. */
  panel: Panel | null;
  onSignIn: () => void;
  onClosePanel: () => void;
  onSignedIn: () => void;
  onFailed: (detail: string) => void;
}

/** The window while nobody is signed in: the wall, and the login dialog
 *  it opens. */
export function SignedOutApp({
  client,
  panel,
  onSignIn,
  onClosePanel,
  onSignedIn,
  onFailed,
}: SignedOutAppProps) {
  return (
    <>
      <SignInWall client={client} onSignIn={onSignIn} />
      {/* The login dialog belongs to this branch too: the overlays at
          the foot of the app are not drawn here. */}
      {panel?.kind === "login" && (
        <LoginDialog
          client={client}
          onClose={onClosePanel}
          // The wall is gated on ``status.cloud_email``; asked for
          // rather than waited on, so the app opens as soon as it can.
          onSignedIn={onSignedIn}
          onFailed={onFailed}
        />
      )}
    </>
  );
}
