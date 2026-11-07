/**
 * The window events the retry banner listens for, dispatched by the
 * push-channel router when the server retries an HTTP request.
 *
 * They are typed `Event` subclasses rather than `CustomEvent` details, so
 * a listener checks what it got with `instanceof` instead of a cast.
 */

import type { HttpRetryAttempt } from "../protocol/pushChannels";

export const HTTP_RETRY_ATTEMPT_EVENT = "ember:http_retry_attempt";
export const HTTP_RETRY_SUCCEEDED_EVENT = "ember:http_retry_succeeded";

/** The attempt shown when the server does not say which one it is. */
const DEFAULT_ATTEMPT = 2;
/** The backoff assumed when the server does not say how long it is. */
const DEFAULT_DELAY_SECONDS = 0.1;
/** How long a notice outlives its backoff, for the retried request to land. */
const SETTLE_SECONDS = 1;

/** A request is being retried: which attempt, after how long, to where. */
export class HttpRetryAttemptEvent extends Event {
  readonly attempt: number;
  readonly delaySeconds: number;
  readonly url: string | undefined;

  constructor(push: Omit<HttpRetryAttempt, "channel">) {
    super(HTTP_RETRY_ATTEMPT_EVENT);
    this.attempt = push.attempt || DEFAULT_ATTEMPT;
    this.delaySeconds = push.delaySeconds || DEFAULT_DELAY_SECONDS;
    this.url = push.url;
  }

  /** The backoff, in milliseconds. */
  get delayMs(): number {
    return this.delaySeconds * 1000;
  }

  /** When a notice of this attempt should go away on its own. */
  get dismissAfterMs(): number {
    return (this.delaySeconds + SETTLE_SECONDS) * 1000;
  }
}

/** The retried request went through. */
export class HttpRetrySucceededEvent extends Event {
  constructor() {
    super(HTTP_RETRY_SUCCEEDED_EVENT);
  }
}
