/**
 * How the app tells the person something outside the conversation.
 *
 * Toasts are the window model's (``ui.toasts``), so an extension's land
 * in the same stack. A notification goes to the host first — the
 * desktop app hands it to the OS — and falls back to a toast where
 * there is no native bridge.
 */

import type { PageRoute } from "../chat/pageStack";
import type { WindowModel } from "../clientState";
import type { Host } from "../lib/host";

export interface ToastInput {
  title: string;
  body?: string;
  /** Where clicking the toast goes. */
  target?: PageRoute;
}

export interface NotifyInput extends ToastInput {
  /** Forwarded back when the native notification is clicked. */
  data?: Record<string, unknown>;
}

/** The text of the ping a finished reply sends a backgrounded tab. */
const REPLY_READY = { title: "igni", body: "Your reply is ready." } as const;

export class Notifier {
  constructor(
    private readonly windowModel: Pick<WindowModel, "toast" | "dismissToast">,
    private readonly host: Pick<Host, "notify">,
  ) {}

  toast(toast: ToastInput): void {
    this.windowModel.toast({
      text: toast.title,
      kind: "info",
      body: toast.body ?? null,
      target: toast.target ?? null,
    });
  }

  dismiss(id: string): void {
    this.windowModel.dismissToast(id);
  }

  /** The OS when the host can reach it, otherwise a toast. */
  async notify(payload: NotifyInput): Promise<void> {
    const delivered = await this.host.notify({
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });
    if (delivered) return;
    this.toast({ title: payload.title, body: payload.body, target: payload.target });
  }

  /** Ping the OS when a reply finishes while the tab is not in view,
   *  so the person knows to come back. Asks for permission once. */
  replyReady(): void {
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    try {
      if (typeof Notification === "undefined") return;
      if (Notification.permission === "granted") {
        new Notification(REPLY_READY.title, { body: REPLY_READY.body, silent: true });
      } else if (Notification.permission !== "denied") {
        void Notification.requestPermission();
      }
    } catch {
      /* notifications unsupported or blocked */
    }
  }
}
