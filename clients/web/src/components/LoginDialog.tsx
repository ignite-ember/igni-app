import type { IgniClient } from "../protocol/client";
import { LoginPanel } from "./panels/LoginPanel";

/** The sign-in flow over the chat. It closes itself either way; what a
 *  success or a failure means is the caller's. */
export function LoginDialog({
  client,
  onClose,
  onSignedIn,
  onFailed,
}: {
  client: IgniClient;
  onClose: () => void;
  onSignedIn: (who: string) => void;
  onFailed: (detail: string) => void;
}) {
  return (
    <LoginPanel
      client={client}
      onDone={(ok, detail) => {
        onClose();
        if (ok) onSignedIn(detail);
        else onFailed(detail);
      }}
    />
  );
}
