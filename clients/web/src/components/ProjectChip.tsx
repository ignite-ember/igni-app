import { FolderIcon } from "./Icons";

/** The folder this session is locked to; clicking it picks another. */
export function ProjectChip({ projectDir, onPick }: { projectDir: string; onPick: () => void }) {
  return (
    <button
      className="chip"
      title={
        projectDir
          ? `Session locked to ${projectDir} — click to lock a different project`
          : "Lock this session to a project folder"
      }
      onClick={onPick}
    >
      <FolderIcon />{" "}
      <span className="chip-label chip-label-path">
        {/* Isolated, so the right-to-left truncation does not reorder the path. */}
        {projectDir ? `⁨${projectDir}⁩` : "project"}
      </span>
    </button>
  );
}
