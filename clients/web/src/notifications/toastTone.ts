/** How a toast's kind reads: its quiet severity mark and how loudly
 *  assistive technology announces it. */

export type Severity = "info" | "success" | "warning" | "error";

export class ToastTone {
  private constructor(
    readonly severity: Severity,
    /** `alert` interrupts; `status` waits its turn. */
    readonly role: "status" | "alert",
  ) {}

  /** The tone for a toast's `kind`; an unknown kind reads as info. */
  static of(kind: string | null | undefined): ToastTone {
    switch (kind) {
      case "success":
        return new ToastTone("success", "status");
      case "warning":
        return new ToastTone("warning", "alert");
      case "error":
        return new ToastTone("error", "alert");
      default:
        return new ToastTone("info", "status");
    }
  }
}
