/**
 * A user bubble: the person's text with its file and snippet pills, or
 * an extension's message as markdown. Edit and delete truncate the
 * conversation from here.
 */

import { memo, useState, type ReactNode } from "react";

import type { UserItem } from "../../chat/chatItem";
import { UserMessageText, type UserMessageMode } from "../../chat/userMessageText";
import { UserTextTokenizer, type UserTextToken } from "../../chat/userTextTokens";
import { useExtensionName } from "../../extensions/extensionNames";
import { FilePill } from "../FilePill";
import { EditPenIcon, TrashIcon } from "../Icons";
import { ChatMarkdown } from "../markdown/ChatMarkdown";
import type { UserItemHandlers } from "./handlers";
import { UserCodePill } from "./UserCodePill";
import { useMessageEditor, type MessageEditor } from "./useMessageEditor";

function tokenNode(token: UserTextToken): ReactNode {
  switch (token.kind) {
    case "text":
      return token.text;
    case "file":
      return <FilePill key={token.key} path={token.path} />;
    case "codePaste":
      return <UserCodePill key={token.key} block={token.block} />;
  }
}

function MessageEditForm({
  item,
  editor,
  mode,
}: {
  item: UserItem;
  editor: MessageEditor;
  mode: UserMessageMode;
}) {
  return (
    <div className={`msg-user msg-user-editing mode-${mode}`}>
      <textarea
        className="msg-user-edit"
        value={editor.draft}
        autoFocus
        rows={Math.min(8, Math.max(2, editor.draft.split("\n").length))}
        onChange={(e) => editor.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            editor.cancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            editor.submit();
          }
        }}
      />
      <div className="msg-user-edit-bar">
        <span className="msg-user-edit-hint">
          ⌘↵ to save · Esc to cancel — saving wipes the rest of the conversation
        </span>
        <button className="btn btn-sm" onClick={editor.cancel}>
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={!editor.draft.trim() || editor.draft === item.text}
          onClick={editor.submit}
        >
          Save & resend
        </button>
      </div>
    </div>
  );
}

export const UserMessage = memo(function UserMessage({
  item,
  handlers,
}: {
  item: UserItem;
  handlers?: UserItemHandlers;
}) {
  const onEdit = handlers?.edit;
  const onDelete = handlers?.delete;
  const editor = useMessageEditor(item, onEdit);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const mode = new UserMessageText(item.text).mode();
  // Truncation targets the run that owns the message: without one there
  // is nothing to edit or delete, so the controls stay hidden.
  const canMutate = !!item.runId && (onEdit || onDelete);
  const fromName = useExtensionName(item.fromExtension);

  if (editor.editing && onEdit) return <MessageEditForm item={item} editor={editor} mode={mode} />;

  const body =
    mode !== "chat" ? (
      item.text
    ) : item.fromExtension ? (
      <div className="msg-user-markdown">
        <ChatMarkdown text={item.text} />
      </div>
    ) : (
      UserTextTokenizer.tokenize(item.text).map(tokenNode)
    );
  return (
    <div className={`msg-user mode-${mode}${item.fromExtension ? " msg-user-extension" : ""}`}>
      {item.fromExtension && <div className="msg-user-from">from {fromName}</div>}
      {body}
      {canMutate && (
        <div className="msg-user-actions" onClick={(e) => e.stopPropagation()}>
          {confirmingDelete ? (
            <>
              <span className="msg-user-confirm-text">Delete this and everything after?</span>
              <button className="btn btn-sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete?.(item);
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              {onEdit && (
                <button
                  className="msg-user-icon-btn"
                  title="Edit & resend (wipes the rest of the chat)"
                  aria-label="Edit message"
                  onClick={editor.begin}
                >
                  <EditPenIcon />
                </button>
              )}
              {onDelete && (
                <button
                  className="msg-user-icon-btn msg-user-icon-danger"
                  title="Delete this and everything after"
                  aria-label="Delete message"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <TrashIcon />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});
