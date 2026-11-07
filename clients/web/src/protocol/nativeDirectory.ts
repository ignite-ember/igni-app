/**
 * The embedding shell's native folder picker, when it offers one.
 */

declare global {
  interface Window {
    /** Native OS folder picker, injected by the embedding shell
     *  (Tauri dialog plugin). Receives the session's currently locked dir
     *  as the starting location; resolves to an absolute path or
     *  null on cancel. */
    __IGNI_PICK_DIR__?: (start?: string) => Promise<string | null>;
  }
}

/** Pick a folder via the shell's native dialog, or undefined if
 *  this context has none (→ try the BE-side native dialog next). */
export async function pickNativeDirectory(
  start?: string,
): Promise<string | null | undefined> {
  if (!window.__IGNI_PICK_DIR__) return undefined;
  try {
    return await window.__IGNI_PICK_DIR__(start);
  } catch {
    return null;
  }
}
