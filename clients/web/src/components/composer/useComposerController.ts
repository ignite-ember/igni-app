/**
 * The composer's behaviour, assembled per render: the draft binding, input
 * history, the pill registry, the completion menu, uploads and pastes,
 * wired into one {@link ComposerController}; and the handle the host
 * reaches the composer through.
 */

import {
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";

import type { WindowModel } from "../../clientState";
import type { IgniClient } from "../../protocol/client";
import type { EditableInputHandle } from "../EditableInput";
import { CodePillRegistry } from "./CodePillRegistry";
import type { ComposerCatalog, ComposerHandle } from "./composerContract";
import { ComposerController, type SentMessage } from "./ComposerController";
import { ComposerEditor } from "./ComposerEditor";
import { InputHistory } from "./InputHistory";
import { PasteHandler } from "./PasteHandler";
import { useAttachments, type AttachmentsApi } from "./useAttachments";
import { useCompletionMenu, type CompletionMenuApi } from "./useCompletionMenu";
import { useComposerDraft } from "./useComposerDraft";

export interface ComposerBehaviour {
  controller: ComposerController;
  completion: CompletionMenuApi;
  attachments: AttachmentsApi;
  paste: PasteHandler;
  registry: CodePillRegistry;
}

export function useComposerController({
  client,
  windowModel,
  catalog,
  onTyping,
  onSubmit,
  editorRef,
  ref,
}: {
  client: IgniClient;
  windowModel: WindowModel;
  catalog: Pick<ComposerCatalog, "skills" | "backendCommands">;
  onTyping?: (wire: string) => void;
  onSubmit: (text: string) => void;
  editorRef: RefObject<EditableInputHandle | null>;
  ref?: Ref<ComposerHandle>;
}): ComposerBehaviour {
  const binding = useComposerDraft(windowModel);
  const [history, setHistory] = useState(InputHistory.empty);
  const registry = useMemo(() => new CodePillRegistry(), []);
  const editor = useMemo(() => new ComposerEditor(editorRef), [editorRef]);
  const completion = useCompletionMenu({
    client,
    backendCommands: catalog.backendCommands,
    skills: catalog.skills,
  });
  // An upload landing and the host's handle both outlive the render that
  // set them up; they reach the newest controller through this.
  const controllerRef = useRef<ComposerController | null>(null);
  const attachments = useAttachments({
    client,
    onLanded: (path) => controllerRef.current?.landMention(path),
  });

  const controller = new ComposerController({
    binding,
    editor,
    history,
    setHistory,
    registry,
    completion,
    attachments,
    onTyping,
    onSent: (sent: SentMessage) => {
      if (sent.droppedPills.length) {
        console.warn("Dropped code pills with no snippet:", sent.droppedPills);
      }
      onSubmit(sent.text);
    },
  });
  useLayoutEffect(() => {
    controllerRef.current = controller;
  });

  useImperativeHandle(
    ref,
    () => ({ focusAtEnd: () => controllerRef.current?.prepareForPrefill() }),
    [],
  );

  const paste = new PasteHandler({
    client,
    registry,
    binding,
    editor,
    addFiles: attachments.addFiles,
  });

  return { controller, completion, attachments, paste, registry };
}
