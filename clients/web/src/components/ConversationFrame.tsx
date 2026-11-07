import type { ComponentProps } from "react";

import { ConversationList } from "./ConversationList";
import { WelcomeScreen } from "./WelcomeScreen";

/** The transcript's props, and the welcome screen's for while it is
 *  empty. */
export type ConversationFrameProps = ComponentProps<typeof ConversationList> &
  ComponentProps<typeof WelcomeScreen>;

/** The conversation: the welcome screen until there is a first item,
 *  then the transcript. */
export function ConversationFrame({
  items,
  transcript,
  runPhase,
  processing,
  pulsingItemId,
  handlers,
  scroll,
  atBottomNow,
  groupName,
  groupMark,
  status,
  onLogin,
  onCommand,
}: ConversationFrameProps) {
  return (
    <div className="conversation-frame">
      {/* See `.sr-only` in theme.css: the level message content
          sits under, so a heading the model wrote cannot skip from
          the page down to an h3. F138. */}
      <h2 className="sr-only">Conversation</h2>
      {items.length === 0 ? (
        <WelcomeScreen
          groupName={groupName}
          groupMark={groupMark}
          status={status}
          onLogin={onLogin}
          onCommand={onCommand}
        />
      ) : (
        <ConversationList
          items={items}
          transcript={transcript}
          runPhase={runPhase}
          processing={processing}
          pulsingItemId={pulsingItemId}
          handlers={handlers}
          scroll={scroll}
          atBottomNow={atBottomNow}
        />
      )}
    </div>
  );
}
