/**
 * What an update check reported, read at the boundary.
 *
 * Two sources answer the check — the desktop shell's
 * ``igni_check_update`` and the backend's ``check_for_update`` — and the
 * update dialog round-trips it through ``ui.dialog``. All three are
 * untyped, so each goes through {@link UpdateInfo.parse}.
 */

import type { UpdatePromptInfo } from "../components/UpdatePrompt";
import { WirePayload } from "../protocol/wirePayload";

/** The dialog kind the update sheet opens as. */
export const UPDATE_DIALOG_KIND = "update";

export class UpdateInfo {
  constructor(
    readonly available: boolean,
    readonly currentVersion: string,
    readonly latestVersion: string,
    readonly downloadUrl?: string,
  ) {}

  /** The check's answer, or ``null`` when there was none. */
  static parse(raw: unknown): UpdateInfo | null {
    if (!WirePayload.isRecord(raw)) return null;
    const p = new WirePayload(raw);
    return new UpdateInfo(
      p.flag("available"),
      p.string("current_version"),
      p.string("latest_version"),
      p.optionalString("download_url"),
    );
  }

  /** Read back from the ``ui.dialog`` spec {@link toDialogSpec} opened. */
  static fromDialogSpec(spec: Record<string, unknown>): UpdateInfo | null {
    return spec.kind === UPDATE_DIALOG_KIND ? UpdateInfo.parse(spec) : null;
  }

  /** The wire shape the update sheet reads. */
  toWire(): UpdatePromptInfo {
    return {
      available: this.available,
      current_version: this.currentVersion,
      latest_version: this.latestVersion,
      ...(this.downloadUrl !== undefined ? { download_url: this.downloadUrl } : {}),
    };
  }

  toDialogSpec(): Record<string, unknown> {
    return { kind: UPDATE_DIALOG_KIND, ...this.toWire() };
  }
}
