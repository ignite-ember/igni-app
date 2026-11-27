import { useState, type ReactNode } from "react";

import type { BackendSnapshot } from "../cloud/backendState";
import { noticeText, refusalText, unreachableText } from "../cloud/backendTexts";
import { host } from "../lib/host";
import { Button } from "./page/Button";

/** The shell calls the banner's buttons make; a test passes its own. */
export interface BackendActions {
  signIn: () => Promise<void>;
  retry: () => void;
  useThisComputer: () => Promise<void>;
  dismiss: () => void;
}

const SHELL_ACTIONS: BackendActions = {
  signIn: () => host.cloudSignIn(),
  retry: () => host.cloudRetry(),
  useThisComputer: () => host.switchBackend("local"),
  dismiss: () => host.dismissBackendNotice(),
};

/**
 * One banner per error state of the cloud side (design §4.2, §8), and the
 * shell's notices about a mode the organisation changed (§6.6). Drawn
 * over the chat, above the composer. `needs_desktop_sign_in` has none:
 * the shell points the window at this computer's backend, whose sign-in
 * wall is the one the app already has.
 */
export function BackendBanner({
  backend,
  actions = SHELL_ACTIONS,
}: {
  backend: BackendSnapshot | null;
  actions?: BackendActions;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!backend) return null;

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    action()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const useLocal = backend.canUseLocal && backend.side === "cloud" && (
    <Button size="sm" disabled={busy} onClick={() => run(actions.useThisComputer)}>
      Use this computer
    </Button>
  );
  const failure = error && (
    <span className="backend-banner-error" role="alert">
      {error}
    </span>
  );

  let body: { tone: "warn" | "bad" | "info"; text: string; buttons: ReactNode } | null = null;
  if (backend.side === "cloud" && backend.state === "cloud_needs_sign_in") {
    body = {
      tone: "warn",
      text: "Your cloud igni needs you to sign in again.",
      buttons: (
        <Button variant="primary" size="sm" disabled={busy} onClick={() => run(actions.signIn)}>
          Sign in
        </Button>
      ),
    };
  } else if (backend.side === "cloud" && backend.state === "cloud_unreachable") {
    body = {
      tone: "bad",
      text: unreachableText(backend),
      buttons: (
        <>
          <Button size="sm" onClick={actions.retry}>
            Retry
          </Button>
          {useLocal}
        </>
      ),
    };
  } else if (backend.state === "refused") {
    const fallback = backend.side === "local" ? " Using this computer instead." : "";
    body = {
      tone: "bad",
      text: `${refusalText(backend.reason)}${fallback}`,
      buttons:
        backend.side === "local" ? (
          <Button size="sm" onClick={actions.dismiss}>
            Dismiss
          </Button>
        ) : null,
    };
  } else if (backend.notice) {
    body = {
      tone: "info",
      text: noticeText(backend.notice),
      buttons:
        backend.notice.kind === "moving_to_cloud" ? null : (
          <Button size="sm" onClick={actions.dismiss}>
            Dismiss
          </Button>
        ),
    };
  }
  if (!body) return null;
  return (
    <div className={`backend-banner tone-${body.tone}`} role="status" data-state={backend.state}>
      <span className="backend-banner-text">{body.text}</span>
      <span className="backend-banner-actions">{body.buttons}</span>
      {failure}
    </div>
  );
}
