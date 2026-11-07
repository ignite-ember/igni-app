import type { AssistantInterrupted } from "../chat/chatItem";

export const ASSISTANT_INTERRUPTED_LABELS: Record<AssistantInterrupted, string> = {
  cancelled: "Run cancelled",
  errored: "Run stopped",
  abandoned: "Run interrupted",
};
