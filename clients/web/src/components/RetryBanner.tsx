/**
 * Real-time retry banner that appears when HTTP requests are being retried
 * and automatically dismisses on success.
 *
 * Listens for the window events in `chat/httpRetryEvents.ts` and mounts a
 * transient notice per attempt, showing the attempt number and a countdown
 * of its backoff. Notices stack if several retries overlap (rare but
 * possible); each dismisses itself once its backoff has had time to land,
 * and a success clears them all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HTTP_RETRY_ATTEMPT_EVENT,
  HTTP_RETRY_SUCCEEDED_EVENT,
  HttpRetryAttemptEvent,
} from "../chat/httpRetryEvents";
import { RetryIcon } from "./Icons";
import "./RetryBanner.css";

/** How often a notice's countdown bar is redrawn. */
const COUNTDOWN_TICK_MS = 50;

/** One retry attempt on screen, from the moment it was shown. */
class RetryNotice {
  constructor(
    readonly id: number,
    readonly attempt: HttpRetryAttemptEvent,
    readonly shownAt: number,
  ) {}

  /** How much of the backoff is left at `now`, from 100 down to 0. */
  percentLeft(now: number): number {
    const remaining = Math.max(0, this.attempt.delayMs - (now - this.shownAt));
    return (remaining / this.attempt.delayMs) * 100;
  }
}

export function RetryBanner() {
  const [retries, setRetries] = useState<RetryNotice[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    const onAttempt = (e: Event) => {
      if (!(e instanceof HttpRetryAttemptEvent)) return;
      const notice = new RetryNotice(nextId.current++, e, Date.now());
      setRetries((prev) => [...prev, notice]);
    };
    const onSucceeded = () => setRetries([]);

    window.addEventListener(HTTP_RETRY_ATTEMPT_EVENT, onAttempt);
    window.addEventListener(HTTP_RETRY_SUCCEEDED_EVENT, onSucceeded);
    return () => {
      window.removeEventListener(HTTP_RETRY_ATTEMPT_EVENT, onAttempt);
      window.removeEventListener(HTTP_RETRY_SUCCEEDED_EVENT, onSucceeded);
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setRetries((prev) => prev.filter((r) => r.id !== id));
  }, []);

  if (retries.length === 0) {
    return null;
  }

  return (
    <div className="retry-banner-container">
      {retries.map((retry) => (
        <RetryBannerItem key={retry.id} retry={retry} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function RetryBannerItem({
  retry,
  onDismiss,
}: {
  retry: RetryNotice;
  onDismiss: (id: number) => void;
}) {
  const [countdownPercent, setCountdownPercent] = useState(100);

  // Owned by the notice, so unmounting it (a success, or the banner going
  // away) clears its timers too.
  useEffect(() => {
    const dismissTimer = setTimeout(() => onDismiss(retry.id), retry.attempt.dismissAfterMs);
    const interval = setInterval(() => {
      const percent = retry.percentLeft(Date.now());
      setCountdownPercent(percent);
      if (percent === 0) {
        clearInterval(interval);
      }
    }, COUNTDOWN_TICK_MS);

    return () => {
      clearTimeout(dismissTimer);
      clearInterval(interval);
    };
  }, [retry, onDismiss]);

  return (
    <div className="retry-banner">
      <div className="retry-banner-content">
        <span className="retry-banner-icon">
          <RetryIcon />
        </span>
        <div className="retry-banner-text">
          <span className="retry-banner-label">
            Retrying request (attempt {retry.attempt.attempt}...)
          </span>
          {retry.attempt.url && <span className="retry-banner-url">{retry.attempt.url}</span>}
        </div>
      </div>
      <div className="retry-banner-progress">
        <div
          className="retry-banner-progress-bar"
          style={{ width: `${countdownPercent}%` }}
        />
      </div>
    </div>
  );
}
