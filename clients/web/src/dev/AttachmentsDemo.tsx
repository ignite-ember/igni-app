/**
 * The files a sent message carries, in each of their forms.
 *
 * Reachable at ``?demo=attachments`` (see ``main.tsx``). Every state is
 * canned — a fake client answers the byte reads, and the uploads are
 * registered with the names and sizes they would have had — so the
 * block under the message can be looked at without a backend.
 */

import { AttachmentContext } from "../chat/attachmentContext";
import { UserMessage } from "../components/chatItems/UserMessage";
import type { UserItem } from "../chat/chatItem";
import { uploadRegistry } from "../chat/uploadRegistry";
import { FileViewerContext } from "../components/pages/files/viewerContext";
import type { IgniClient } from "../protocol/client";

const PROJECT = "/work/igni";

/** A picture, as the bytes of an SVG would arrive. */
function picture(label: string, from: string, to: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="320" height="320" fill="url(#g)"/>` +
    `<circle cx="238" cy="74" r="44" fill="rgba(255,255,255,0.5)"/>` +
    `<path d="M0 248 L92 168 L162 232 L232 176 L320 258 L320 320 L0 320 Z" fill="rgba(0,0,0,0.26)"/>` +
    `<text x="18" y="46" font-family="system-ui" font-size="24" fill="rgba(255,255,255,0.94)">${label}</text>` +
    `</svg>`;
  return btoa(svg);
}

const PICTURES: Record<string, string> = {
  "shot-dawn.png": picture("dawn", "#f0a05a", "#8c3f6b"),
  "shot-harbour.png": picture("harbour", "#5b8cc9", "#1d3557"),
  "shot-roof.png": picture("roof", "#8fb996", "#33603c"),
};

/** The client the demo's byte reads go over. */
const CLIENT = {
  rpc: async (method: string, args?: Record<string, unknown>) => {
    if (method !== "read_file_bytes") return {};
    const path = String(args?.path);
    const name = path.split("/").pop() ?? path;
    return {
      path,
      data: PICTURES[name] ?? PICTURES["shot-dawn.png"],
      size: 41_233,
      media_type: "image/svg+xml",
    };
  },
} as unknown as IgniClient;

interface Upload {
  name: string;
  file: string;
  size: number;
}

/** Register an upload the way the composer would. */
function uploaded(name: string, size: number): Upload {
  const file = `${PROJECT}/.igni/attachments/sess-1/${name}`;
  uploadRegistry.remember(file, { name, size });
  return { name, file, size };
}

const REPORT = uploaded("Q3-report.pdf", 482_310);
const BUDGET = uploaded("budget.xlsx", 92_144);
const NOTES = uploaded("notes.txt", 1_204);
const DAWN = uploaded("shot-dawn.png", 41_233);
const HARBOUR = uploaded("shot-harbour.png", 51_002);
const ROOF = uploaded("shot-roof.png", 38_771);

const MESSAGES: { title: string; lede: string; item: UserItem }[] = [
  {
    title: "Documents",
    lede: "The files land in the session's attachments folder, and are drawn as rows.",
    item: {
      kind: "user",
      id: 1,
      text: `Here is what you asked for: @${REPORT.file} @${BUDGET.file} @${NOTES.file}`,
    },
  },
  {
    title: "Images",
    lede: "Images are drawn as miniatures, read only when they come into view.",
    item: {
      kind: "user",
      id: 2,
      text: `And the photos from the site visit: @${DAWN.file} @${HARBOUR.file} @${ROOF.file}`,
    },
  },
  {
    title: "A file only mentioned",
    lede: "A file named in the sentence stays inline: it is a reference, not a file sent.",
    item: {
      kind: "user",
      id: 3,
      text: "Have a look at @src/main.py before you change anything",
    },
  },
  {
    title: "Both",
    lede: "The upload is drawn as the block; the reference stays in the sentence.",
    item: {
      kind: "user",
      id: 4,
      text: `The log is in @src/main.py and the capture in @${DAWN.file}`,
    },
  },
];

export function AttachmentsDemo() {
  return (
    <main className="demo-page">
      <header className="demo-page-header">
        <h1>The files a sent message carries</h1>
        <p className="demo-page-lede">
          An upload is drawn as a block under the message — documents as rows, images as
          miniatures. A file the person only names stays inline, as a chip in the sentence.
        </p>
      </header>
      <div className="demo-page-grid">
        {MESSAGES.map((message) => (
          <section className="demo-page-panel" key={message.item.id}>
            <h2 className="demo-page-panel-title">{message.title}</h2>
            <p className="demo-page-panel-subtitle">{message.lede}</p>
            <div className="demo-page-panel-body">
              <FileViewerContext.Provider value={{ open: () => {} }}>
                <AttachmentContext.Provider value={{ projectDir: PROJECT, client: CLIENT }}>
                  <UserMessage item={message.item} />
                </AttachmentContext.Provider>
              </FileViewerContext.Provider>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
