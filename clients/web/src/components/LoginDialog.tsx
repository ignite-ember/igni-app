import type { IgniClient } from "../protocol/client";
import { LoginPanel } from "./panels/LoginPanel";

/** The sign-in flow over the chat. It closes itself either way; what a
 *  success or a failure means is the caller's. */
export function LoginDialog({
  client,
  onClose,
  onSignedIn,
  onFailed,
  overWall,
}: {
  client: IgniClient;
  /** Opened from the sign-in wall, so drawn above it. */
  overWall?: boolean;
  onClose: () => void;
  onSignedIn: (who: string) => void;
  onFailed: (detail: string) => void;
}) {
  return (
    <LoginPanel
      client={client}
      overWall={overWall}
      // A cancel only closes the dialog: the person knows they
      // cancelled, and a "Login failed: cancelled" line would outlive
      // the sign-in that follows it.
      onCancel={onClose}
      onDone={(ok, detail) => {
        onClose();
        if (ok) onSignedIn(detail);
        else onFailed(detail);
      }}
    />
  );
}
