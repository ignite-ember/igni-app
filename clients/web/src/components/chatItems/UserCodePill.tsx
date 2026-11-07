/**
 * A pasted snippet inside a user bubble, drawn like the composer's code
 * pill. A click opens the file with the snippet's lines selected; an
 * alt-click previews the snippet under the pill.
 */

import { useState } from "react";

import type { CodePasteBlock } from "../../chat/codePaste";
import { host } from "../../lib/host";
import { CodeBracketIcon } from "../Icons";
import { guessLang } from "../markdown/hljsLanguage";
import { PlainMarkdown } from "../markdown/PlainMarkdown";

export function UserCodePill({ block }: { block: CodePasteBlock }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="user-code-pill-wrap">
      <button
        type="button"
        className="file-pill code-pill inline-pill"
        title={`${block.path}:${block.line} — click to open in editor (alt-click to preview snippet)`}
        onClick={(e) => {
          e.stopPropagation();
          if (e.altKey) {
            setOpen((v) => !v);
            return;
          }
          // A host that does not read the ``-end`` suffix opens at the start.
          void host.openFile(`${block.path}:${block.firstRange}`);
        }}
      >
        <span className="file-pill-icon" aria-hidden="true">
          <CodeBracketIcon />
        </span>
        <span className="file-pill-name">{`${block.fileName} ${block.lineSpec}`}</span>
      </button>
      {open && (
        <div className="user-code-pill-snippet">
          <PlainMarkdown text={"```" + guessLang(block.path) + "\n" + block.snippet + "\n```"} />
        </div>
      )}
    </span>
  );
}
