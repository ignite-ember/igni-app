import { FolderIcon } from "./Icons";

/** The folder this session is locked to; clicking it picks another.
 *  `readOnly` on the desktop's cloud side: the folder is the VM's
 *  workspace, and there is no dialog to pick another (design §5). */
export function ProjectChip({
  projectDir,
  onPick,
  readOnly = false,
}: {
  projectDir: string;
  onPick: () => void;
  readOnly?: boolean;
}) {
  return (
    <button
      className={readOnly ? "chip chip-readonly" : "chip"}
      title={
        readOnly
          ? `Your cloud igni's workspace${projectDir ? `: ${projectDir}` : ""}`
          : projectDir
            ? `Session locked to ${projectDir} — click to lock a different project`
            : "Lock this session to a project folder"
      }
      disabled={readOnly}
      onClick={readOnly ? undefined : onPick}
    >
      <FolderIcon />{" "}
      <span className="chip-label chip-label-path">
        {/* Isolated, so the right-to-left truncation does not reorder the path. */}
        {projectDir ? `⁨${projectDir}⁩` : "project"}
      </span>
    </button>
  );
}
