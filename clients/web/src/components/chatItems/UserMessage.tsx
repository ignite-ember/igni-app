/**
 * A user bubble: the person's text with its file and snippet pills, or
 * an extension's message as markdown. The files the person uploaded
 * are drawn as a block under the text; the files they only mention stay
 * inline, as chips in the sentence. Edit and delete truncate the
 * conversation from here.
 */

import { memo, useMemo, useState, type ReactNode } from "react";

import { useAttachmentContext } from "../../chat/attachmentContext";
import type { UserItem } from "../../chat/chatItem";
import { MessageAttachments } from "../../chat/messageAttachments";
import { UserMessageText, type UserMessageMode } from "../../chat/userMessageText";
import type { UserTextToken } from "../../chat/userTextTokens";
import { useExtensionName } from "../../extensions/extensionNames";
import { EditPenIcon, TrashIcon } from "../Icons";
import { MentionChip } from "../MentionChip";
import { ChatMarkdown } from "../markdown/ChatMarkdown";
import { Button } from "../page/Button";
import { AttachmentBlock } from "./AttachmentBlock";
import type { UserItemHandlers } from "./handlers";
import { UserCodePill } from "./UserCodePill";
import { useMessageEditor, type MessageEditor } from "./useMessageEditor";

/** One token of the message, drawn. An upload's chip is left out: the
 *  block under the message draws it, and it is not shown twice. */
function tokenNode(token: UserTextToken, attachments: MessageAttachments): ReactNode {
  switch (token.kind) {
    case "text":
      return token.text;
    case "file":
      if (attachments.isUpload(token.path)) return null;
      return <MentionChip key={token.key} path={token.path} />;
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
        <Button size="sm" onClick={editor.cancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={!editor.draft.trim() || editor.draft === item.text}
          onClick={editor.submit}
        >
          Save & resend
        </Button>
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
  const windowPlace = useAttachmentContext();
  const projectDir = windowPlace?.projectDir ?? "";
  const attachments = useMemo(
    () => new MessageAttachments(item.text, { projectDir }),
    [item.text, projectDir],
  );

  if (editor.editing && onEdit) return <MessageEditForm item={item} editor={editor} mode={mode} />;

  // The message's own text is tokenised only for a chat message: a
  // command and an extension's message are drawn as they are.
  const tokenised = mode === "chat" && !item.fromExtension;
  const body =
    mode !== "chat" ? (
      item.text
    ) : item.fromExtension ? (
      <div className="msg-user-markdown">
        <ChatMarkdown text={item.text} />
      </div>
    ) : (
      attachments.tokens.map((token) => tokenNode(token, attachments))
    );
  return (
    <div className={`msg-user mode-${mode}${item.fromExtension ? " msg-user-extension" : ""}`}>
      {item.fromExtension && <div className="msg-user-from">from {fromName}</div>}
      {body}
      {tokenised && attachments.uploads.length > 0 && (
        <AttachmentBlock uploads={attachments.uploads} client={windowPlace?.client ?? null} />
      )}
      {canMutate && (
        <div className="msg-user-actions" onClick={(e) => e.stopPropagation()}>
          {confirmingDelete ? (
            <>
              <span className="msg-user-confirm-text">Delete this and everything after?</span>
              <Button size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete?.(item);
                }}
              >
                Delete
              </Button>
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
