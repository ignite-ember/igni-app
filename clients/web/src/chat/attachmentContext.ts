/**
 * What a message's attachments need from the window: the project the
 * chat is about (to tell an upload from a reference) and the client (to
 * read an image's bytes).
 *
 * The window provides it, above the transcript; a message drawn
 * without one (a test, say) has no project to classify against and no
 * client to read with, so its uploads are drawn as rows.
 */

import { createContext, useContext } from "react";

import type { IgniClient } from "../protocol/client";

export interface AttachmentContextValue {
  /** The project's directory; "" when the window is not locked to one. */
  projectDir: string;
  /** The client the window talks to. */
  client: IgniClient;
}

export const AttachmentContext = createContext<AttachmentContextValue | null>(null);

/** What the window provides, or ``null`` where it provides nothing. */
export function useAttachmentContext(): AttachmentContextValue | null {
  return useContext(AttachmentContext);
}
