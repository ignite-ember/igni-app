/**
 * Picking the folder to lock a session to.
 *
 * Three ways, best first: the desktop shell's native dialog; the
 * backend's, which can open the real OS picker even for a browser tab
 * because the backend runs on the person's machine; and, when neither
 * can (a headless Linux box), the in-app browser.
 */

import type { IgniClient } from "../protocol/client";
import { pickNativeDirectory } from "../protocol/nativeDirectory";
import { PickDirResult } from "../protocol/rpcResults";

/** The backend's dialog waits for a person, for as long as they take. */
export const PICK_DIR_TIMEOUT_MS = 600_000;

export type FolderPick =
  | { kind: "picked"; path: string }
  | { kind: "cancelled" }
  /** No native dialog could open: show the in-app picker. */
  | { kind: "in-app" };

export class ProjectFolderPicker {
  constructor(
    private readonly client: Pick<IgniClient, "rpc">,
    private readonly pickNative: (start?: string) => Promise<string | null | undefined> = pickNativeDirectory,
  ) {}

  async pick(current: string): Promise<FolderPick> {
    const native = await this.pickNative(current);
    if (native) return { kind: "picked", path: native };
    if (native === null) return { kind: "cancelled" };
    try {
      const res = PickDirResult.parse(
        await this.client.rpc<unknown>("pick_dir_native", {}, PICK_DIR_TIMEOUT_MS),
      );
      if (res.path) return { kind: "picked", path: res.path };
      if (res.cancelled) return { kind: "cancelled" };
    } catch {
      /* no backend dialog: the in-app picker */
    }
    return { kind: "in-app" };
  }
}
