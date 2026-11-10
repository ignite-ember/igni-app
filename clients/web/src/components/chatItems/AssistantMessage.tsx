/** The agent's reply, with the recovery banner when its run was cut off. */

import { memo } from "react";

import type { AssistantItem } from "../../chat/chatItem";
import { ChatMarkdown } from "../markdown/ChatMarkdown";
import type { InterruptedHandlers } from "./handlers";
import { InterruptedBanner, type InterruptedActions } from "./InterruptedBanner";

function bannerActions(itemId: number, handlers: InterruptedHandlers): InterruptedActions {
  const bind = (handler?: (id: number) => void) => (handler ? () => handler(itemId) : undefined);
  return {
    retry: bind(handlers.retry),
    discard: bind(handlers.discard),
    editPrompt: bind(handlers.editPrompt),
  };
}

/** Also mounted on its own by the ``?demo=interrupted`` sandbox. */
export const AssistantMessage = memo(function AssistantMessage({
  item,
  handlers,
}: {
  item: AssistantItem;
  handlers?: InterruptedHandlers;
}) {
  return (
    <div className="msg-assistant">
      <div className="msg-assistant-body">
        <ChatMarkdown text={item.text} />
      </div>
      {item.interrupted && (
        <InterruptedBanner reason={item.interrupted} actions={bannerActions(item.id, handlers ?? {})} />
      )}
    </div>
  );
});
