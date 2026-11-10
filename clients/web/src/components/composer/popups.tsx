/**
 * The composer's popups, as markup: the tools list, the model picker, the
 * completion menu, and the backdrop that closes a click-opened one.
 */

import type { ModelChoice } from "../../protocol/composerWire";
import type { CompletionMenu, MenuEntry } from "./completionMenu";
import type { CompletionMenuApi } from "./useCompletionMenu";
import type { ComposerPopupApi } from "./useComposerPopup";

/** A tool the `/` button lists. */
export interface ToolEntry {
  label: string;
  command: string;
  desc: string;
}

/** How close to the bottom of the `@` menu a scroll asks for the next
 *  page — a head start before the person runs out of rows. */
const LOAD_MORE_THRESHOLD_PX = 120;

/** Covers the page under an open popup; a click on it closes the popup. */
export function PopupBackdrop({ onClose }: { onClose: () => void }) {
  return <div className="popup-backdrop" onClick={onClose} />;
}

export function ToolsMenu({
  tools,
  onPick,
  onClose,
}: {
  tools: ToolEntry[];
  onPick: (command: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <PopupBackdrop onClose={onClose} />
      <div className="popup-menu">
        {tools.map((t) => (
          <div key={t.command} className="popup-item" onClick={() => onPick(t.command)}>
            <span className="cmd">{t.label}</span>
            <span className="desc">{t.desc}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function ModelMenu({
  models,
  onPick,
  onClose,
}: {
  models: ModelChoice[];
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <PopupBackdrop onClose={onClose} />
      <div className="popup-menu model-menu">
        {models.map((m) => (
          <div
            key={m.name}
            className={`popup-item ${m.current ? "active" : ""}`}
            onClick={() => onPick(m.name)}
          >
            <span className="cmd">{m.name}</span>
            {m.current && <span className="desc">current</span>}
          </div>
        ))}
      </div>
    </>
  );
}

export function CompletionMenuView({
  menu,
  onChoose,
  onNearBottom,
}: {
  menu: CompletionMenu;
  onChoose: (entry: MenuEntry) => void;
  /** The `@` menu was scrolled near its end: time for the next page. */
  onNearBottom: () => void;
}) {
  return (
    <div
      className="popup-menu"
      onScroll={(e) => {
        if (menu.kind !== "mention") return;
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD_PX) {
          onNearBottom();
        }
      }}
    >
      {menu.entries.map((entry, i) => (
        <div
          key={entry.key}
          className={`popup-item ${i === menu.active ? "active" : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onChoose(entry);
          }}
        >
          <span className="cmd">{entry.label}</span>
          {entry.desc && <span className="desc">{entry.desc}</span>}
        </div>
      ))}
      {menu.kind === "mention" && menu.total > menu.entries.length && (
        <div className="popup-footer" aria-live="polite">
          Showing {menu.entries.length.toLocaleString()} of {menu.total.toLocaleString()} — scroll
          to load more, or type to narrow
        </div>
      )}
    </div>
  );
}

/** Whichever popup is open above the editor: a bar menu or the
 *  completion menu. Picking from a bar menu closes it first. */
export function ComposerPopupLayer({
  popups,
  tools,
  onTool,
  onPickModel,
  completion,
  onChoose,
}: {
  popups: ComposerPopupApi;
  tools: ToolEntry[];
  onTool: (command: string) => void;
  onPickModel: (name: string) => void;
  completion: Pick<CompletionMenuApi, "menu" | "loadMore">;
  onChoose: (entry: MenuEntry) => void;
}) {
  const { popup } = popups;
  return (
    <>
      {popup.kind === "tools" && (
        <ToolsMenu
          tools={tools}
          onClose={popups.close}
          onPick={(command) => {
            popups.close();
            onTool(command);
          }}
        />
      )}
      {popup.kind === "model" && (
        <ModelMenu
          models={popup.models}
          onClose={popups.close}
          onPick={(name) => {
            popups.close();
            onPickModel(name);
          }}
        />
      )}
      {completion.menu && (
        <CompletionMenuView
          menu={completion.menu}
          onChoose={onChoose}
          onNearBottom={() => void completion.loadMore()}
        />
      )}
    </>
  );
}
